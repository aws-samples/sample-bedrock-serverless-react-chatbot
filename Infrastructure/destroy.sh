#!/bin/bash
# Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

set -e

# Disable AWS CLI pager to prevent interactive prompts
export AWS_PAGER=""

# ==========================================================================
# destroy.sh - Tears down all resources created by deploy.sh
# Operates in reverse deployment order and handles:
#   - Emptying S3 buckets (including versioned objects and delete markers)
#   - Deleting CloudFormation stacks in dependency order
#   - Cleaning up resources with DeletionPolicy: Retain
#   - GovCloud vs Commercial region differences
# ==========================================================================

# Function: detect_region
detect_region() {
    echo "Detecting AWS region..."
    REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]' 2>&1)

    if [ $? -ne 0 ] || [ -z "$REGION" ]; then
        echo "Error: Failed to detect AWS region."
        exit 1
    fi

    if [[ "$REGION" == us-gov-* ]]; then
        IS_GOVCLOUD=true
        echo "Detected GovCloud region: $REGION"
    else
        IS_GOVCLOUD=false
        echo "Detected commercial AWS region: $REGION"
    fi
}

# Function: get_stack_output
get_stack_output() {
    local stack_name=$1
    local output_key=$2
    local region_flag=""
    if [ -n "$3" ]; then
        region_flag="--region $3"
    fi

    local output_value
    output_value=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        $region_flag \
        --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
        --output text 2>/dev/null)

    if [ $? -ne 0 ] || [ -z "$output_value" ] || [ "$output_value" = "None" ]; then
        echo ""
        return 1
    fi

    echo "$output_value"
}

# Function: empty_s3_bucket
# Empties an S3 bucket including all object versions and delete markers.
# Required before CloudFormation can delete versioned buckets.
empty_s3_bucket() {
    local bucket_name=$1

    if [ -z "$bucket_name" ] || [ "$bucket_name" = "None" ]; then
        return 0
    fi

    # Check if bucket exists
    if ! aws s3api head-bucket --bucket "$bucket_name" 2>/dev/null; then
        echo "  Bucket does not exist (skipping): $bucket_name"
        return 0
    fi

    echo "  Emptying bucket: $bucket_name"

    # Delete all object versions (handles versioned buckets)
    echo "    Deleting object versions..."
    local versions
    versions=$(aws s3api list-object-versions \
        --bucket "$bucket_name" \
        --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' \
        --output json 2>/dev/null)

    if [ -n "$versions" ] && [ "$versions" != '{"Objects": null}' ] && [ "$versions" != "null" ]; then
        # Process in batches of 1000 (S3 delete-objects limit)
        echo "$versions" | python3 -c "
import sys, json
data = json.load(sys.stdin)
objects = data.get('Objects') or []
batch_size = 1000
for i in range(0, len(objects), batch_size):
    batch = objects[i:i+batch_size]
    print(json.dumps({'Objects': batch, 'Quiet': True}))
" | while read -r batch; do
            aws s3api delete-objects --bucket "$bucket_name" --delete "$batch" > /dev/null 2>&1 || true
        done
        echo "    Object versions deleted"
    else
        echo "    No object versions found"
    fi

    # Delete all delete markers
    echo "    Deleting delete markers..."
    local markers
    markers=$(aws s3api list-object-versions \
        --bucket "$bucket_name" \
        --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' \
        --output json 2>/dev/null)

    if [ -n "$markers" ] && [ "$markers" != '{"Objects": null}' ] && [ "$markers" != "null" ]; then
        echo "$markers" | python3 -c "
import sys, json
data = json.load(sys.stdin)
objects = data.get('Objects') or []
batch_size = 1000
for i in range(0, len(objects), batch_size):
    batch = objects[i:i+batch_size]
    print(json.dumps({'Objects': batch, 'Quiet': True}))
" | while read -r batch; do
            aws s3api delete-objects --bucket "$bucket_name" --delete "$batch" > /dev/null 2>&1 || true
        done
        echo "    Delete markers removed"
    else
        echo "    No delete markers found"
    fi

    echo "  Bucket emptied: $bucket_name"
}

# Function: delete_stack
# Deletes a CloudFormation stack and waits for completion.
delete_stack() {
    local stack_name=$1
    local region_flag=""
    if [ -n "$2" ]; then
        region_flag="--region $2"
    fi

    # Check if stack exists
    if ! aws cloudformation describe-stacks --stack-name "$stack_name" $region_flag &>/dev/null; then
        echo "Stack does not exist (skipping): $stack_name"
        return 0
    fi

    # Handle REVIEW_IN_PROGRESS state
    local stack_status
    stack_status=$(aws cloudformation describe-stacks --stack-name "$stack_name" $region_flag \
        --query 'Stacks[0].StackStatus' --output text 2>/dev/null)

    if [ "$stack_status" = "REVIEW_IN_PROGRESS" ]; then
        echo "Stack $stack_name is in REVIEW_IN_PROGRESS state, deleting change set first..."
        local change_set
        change_set=$(aws cloudformation list-change-sets --stack-name "$stack_name" $region_flag \
            --query 'Summaries[0].ChangeSetName' --output text 2>/dev/null)
        if [ -n "$change_set" ] && [ "$change_set" != "None" ]; then
            aws cloudformation delete-change-set --stack-name "$stack_name" $region_flag \
                --change-set-name "$change_set" 2>/dev/null || true
        fi
    fi

    echo "Deleting stack: $stack_name${2:+ (in $2)}"
    aws cloudformation delete-stack --stack-name "$stack_name" $region_flag

    echo "Waiting for stack deletion: $stack_name"
    if aws cloudformation wait stack-delete-complete --stack-name "$stack_name" $region_flag; then
        echo "Successfully deleted stack: $stack_name"
    else
        echo "Warning: Stack deletion may have failed or timed out: $stack_name"
        echo "Check the CloudFormation console for details."
        return 1
    fi
}

# Function: delete_retained_bucket
# Manually deletes a bucket that has DeletionPolicy: Retain.
# CloudFormation won't delete these, so we handle them ourselves.
delete_retained_bucket() {
    local bucket_name=$1

    if [ -z "$bucket_name" ] || [ "$bucket_name" = "None" ]; then
        return 0
    fi

    if ! aws s3api head-bucket --bucket "$bucket_name" 2>/dev/null; then
        echo "  Retained bucket does not exist (skipping): $bucket_name"
        return 0
    fi

    echo "  Cleaning up retained bucket: $bucket_name"
    empty_s3_bucket "$bucket_name"
    echo "  Deleting retained bucket: $bucket_name"
    aws s3api delete-bucket --bucket "$bucket_name" 2>/dev/null || {
        echo "  Warning: Could not delete retained bucket: $bucket_name"
        echo "  You may need to delete it manually."
    }
}

# ==========================================
# Main script
# ==========================================

detect_region

# Parse command line arguments
STACK_NAME=""
SKIP_CONFIRM=false
DELETE_RETAINED=true

while [[ $# -gt 0 ]]; do
    case "$1" in
        --stack-name)
            STACK_NAME="$2"
            shift 2
            ;;
        --yes|-y)
            SKIP_CONFIRM=true
            shift
            ;;
        --keep-retained)
            DELETE_RETAINED=false
            shift
            ;;
        --help|-h)
            echo "Usage: ./destroy.sh --stack-name <name> [options]"
            echo ""
            echo "Required:"
            echo "  --stack-name <name>    Base name used during deployment"
            echo ""
            echo "Options:"
            echo "  --yes, -y              Skip confirmation prompt"
            echo "  --keep-retained        Don't delete buckets with DeletionPolicy: Retain"
            echo "                         (CloudFront logs bucket, API Gateway log group)"
            echo "  --help, -h             Show this help message"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

if [ -z "$STACK_NAME" ]; then
    echo "Error: --stack-name is required"
    echo "Usage: ./destroy.sh --stack-name <name> [--yes] [--keep-retained]"
    exit 1
fi

# Get AWS account ID for bucket name resolution
ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text 2>/dev/null)
if [ -z "$ACCOUNT_ID" ]; then
    echo "Error: Could not determine AWS account ID. Check your credentials."
    exit 1
fi

# Generate the same unique suffix used during deployment
UNIQUE_SUFFIX=$(echo -n "${ACCOUNT_ID}" | sha256sum | cut -c1-8)

echo "=========================================="
echo "AWS Bedrock Agent Chatbot - DESTROY"
echo "=========================================="
echo "Region:       $REGION"
echo "Stack Name:   $STACK_NAME"
echo "Account ID:   $ACCOUNT_ID"
echo "GovCloud:     $IS_GOVCLOUD"
echo "=========================================="
echo ""
echo "This will PERMANENTLY DELETE all resources for stack: $STACK_NAME"
echo ""

if [ "$SKIP_CONFIRM" != true ]; then
    while true; do
        read -p "Are you sure you want to destroy all resources? (yes/no): " yn
        case $yn in
            [Yy]es ) break ;;
            [Nn]o )
                echo "Destroy cancelled."
                exit 0
                ;;
            * ) echo "Please type 'yes' or 'no'." ;;
        esac
    done
    echo ""
fi

# ==========================================
# Step 1: Delete CloudFront / API Gateway stack (reverse of deploy Step 8)
# ==========================================
if [ "$IS_GOVCLOUD" = true ]; then
    echo "=========================================="
    echo "Step 1: Deleting API Gateway stack (GovCloud)"
    echo "=========================================="
    delete_stack "$STACK_NAME-apigateway"
else
    echo "=========================================="
    echo "Step 1a: Deleting CloudFront stack"
    echo "=========================================="

    # Grab the CloudFront logs bucket name before deleting the stack
    CF_LOGS_BUCKET=$(get_stack_output "$STACK_NAME-cloudfront" "CloudFrontLogsBucketName" 2>/dev/null || echo "")
    # Fallback: construct the name from convention if output not available
    if [ -z "$CF_LOGS_BUCKET" ]; then
        CF_LOGS_BUCKET="${STACK_NAME}-cloudfront-cloudfront-logs-${UNIQUE_SUFFIX}"
    fi

    delete_stack "$STACK_NAME-cloudfront"

    echo ""
    echo "=========================================="
    echo "Step 1b: Deleting WAF WebACL stack (us-east-1)"
    echo "=========================================="
    delete_stack "$STACK_NAME-cloudfront-waf" "us-east-1"
fi
echo ""

# ==========================================
# Step 2: Delete CICD stack (reverse of deploy Step 7)
# ==========================================
echo "=========================================="
echo "Step 2: Deleting CICD stack"
echo "=========================================="
delete_stack "$STACK_NAME-cicd"
echo ""

# ==========================================
# Step 3: Delete Config API stack (reverse of deploy Step 5)
# ==========================================
echo "=========================================="
echo "Step 3: Deleting Config API stack"
echo "=========================================="
delete_stack "$STACK_NAME-config-api"
echo ""

# ==========================================
# Step 4: Delete Cognito stack (reverse of deploy Step 4)
# ==========================================
echo "=========================================="
echo "Step 4: Deleting Cognito stack"
echo "=========================================="
delete_stack "$STACK_NAME-cognito"
echo ""

# ==========================================
# Step 5: Delete Bedrock stack (reverse of deploy Step 3)
# ==========================================
echo "=========================================="
echo "Step 5: Deleting Bedrock stack"
echo "=========================================="
delete_stack "$STACK_NAME-bedrock"
echo ""

# ==========================================
# Step 6: Empty all S3 buckets and delete Foundation stack (reverse of deploy Steps 1-2)
# ==========================================
echo "=========================================="
echo "Step 6: Emptying S3 buckets before Foundation stack deletion"
echo "=========================================="

# All buckets created by the foundation stack (all have versioning enabled)
FOUNDATION_BUCKETS=(
    "${STACK_NAME}-foundation-s3-access-logs-${UNIQUE_SUFFIX}"
    "${STACK_NAME}-foundation-lambda-layer-${UNIQUE_SUFFIX}"
    "${STACK_NAME}-foundation-react-code-${UNIQUE_SUFFIX}"
    "${STACK_NAME}-foundation-cfn-templates-${UNIQUE_SUFFIX}"
    "${STACK_NAME}-foundation-persona-${UNIQUE_SUFFIX}"
    "${STACK_NAME}-foundation-kb-docs-${UNIQUE_SUFFIX}"
    "${STACK_NAME}-foundation-ui-code-${UNIQUE_SUFFIX}"
)

for bucket in "${FOUNDATION_BUCKETS[@]}"; do
    empty_s3_bucket "$bucket"
done
echo ""

echo "=========================================="
echo "Step 7: Deleting Foundation stack"
echo "=========================================="
delete_stack "$STACK_NAME-foundation"
echo ""

# ==========================================
# Step 8: Clean up retained resources
# ==========================================
echo "=========================================="
echo "Step 8: Cleaning up retained resources"
echo "=========================================="

if [ "$DELETE_RETAINED" = true ]; then
    echo "Cleaning up resources with DeletionPolicy: Retain..."

    # CloudFront logs bucket (DeletionPolicy: Retain in cloudfront.yaml)
    if [ "$IS_GOVCLOUD" != true ] && [ -n "$CF_LOGS_BUCKET" ]; then
        delete_retained_bucket "$CF_LOGS_BUCKET"
    fi

    echo "Retained resources cleanup complete"
else
    echo "Skipping retained resources (--keep-retained flag set)"
    if [ "$IS_GOVCLOUD" != true ]; then
        echo "  Note: The CloudFront logs bucket may still exist."
        echo "  You can delete it manually if needed."
    fi
fi
echo ""

# ==========================================
# Step 9: Clean up local artifacts
# ==========================================
echo "=========================================="
echo "Step 9: Cleaning up local artifacts"
echo "=========================================="

if [ -f "reactapplication.zip" ]; then
    echo "Removing local reactapplication.zip"
    rm -f reactapplication.zip
fi
echo "Local cleanup complete"
echo ""

# ==========================================
# Summary
# ==========================================
echo "=========================================="
echo "Destroy Completed"
echo "=========================================="
echo ""
echo "All stacks for '$STACK_NAME' have been deleted."
echo ""
echo "Deleted stacks:"
echo "  - $STACK_NAME-foundation"
echo "  - $STACK_NAME-bedrock"
echo "  - $STACK_NAME-cognito"
echo "  - $STACK_NAME-config-api"
echo "  - $STACK_NAME-cicd"
if [ "$IS_GOVCLOUD" = true ]; then
    echo "  - $STACK_NAME-apigateway"
else
    echo "  - $STACK_NAME-cloudfront"
    echo "  - $STACK_NAME-cloudfront-waf (us-east-1)"
fi
echo ""
if [ "$DELETE_RETAINED" != true ]; then
    echo "Note: Retained resources were NOT deleted (--keep-retained)."
    echo "You may want to manually clean up CloudFront logs buckets."
    echo ""
fi
echo "=========================================="
