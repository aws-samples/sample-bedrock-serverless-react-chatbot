#!/bin/bash
# Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

set -e

# Disable AWS CLI pager to prevent interactive prompts
export AWS_PAGER=""

# Set default model IDs based on Partition
COM_MODEL_ID="us.anthropic.claude-sonnet-4-5-20250929-v1:0"
GOV_MODEL_ID="us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0"

# Function: detect_region
# Purpose: Detect the current AWS region and determine if it's a GovCloud region
# Sets global variables: REGION, IS_GOVCLOUD
# Returns: 0 on success, exits with 1 on failure
detect_region() {
    echo "Detecting AWS region..."
    
    # Attempt to detect region using AWS CLI
    REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]' 2>&1)
    
    # Check if the command failed
    if [ $? -ne 0 ]; then
        echo "Error: Failed to detect AWS region using AWS CLI."
        echo "AWS CLI output: $REGION"
        echo "Please ensure:"
        echo "  1. AWS CLI is installed and configured"
        echo "  2. You have valid AWS credentials"
        echo "  3. Your credentials have ec2:DescribeAvailabilityZones permission"
        exit 1
    fi
    
    # Check if region is empty
    if [ -z "$REGION" ]; then
        echo "Error: Unable to determine AWS region."
        echo "Please configure your AWS CLI or set the AWS_REGION environment variable."
        echo "You can configure AWS CLI by running: aws configure"
        exit 1Iwe
    fi
    
    # Determine if this is a GovCloud region
    # GovCloud regions follow the pattern: us-gov-*
    if [[ "$REGION" == us-gov-* ]]; then
        IS_GOVCLOUD=true
        echo "Detected GovCloud region: $REGION"
    else
        IS_GOVCLOUD=false
        echo "Detected commercial AWS region: $REGION"
    fi
    
    return 0
}

# Function: deploy_stack
# Purpose: Deploy a CloudFormation stack and wait for completion
# Parameters:
#   $1 - Stack name
#   $2 - Template file path
#   $@ - Remaining arguments are parameter key=value pairs
# Returns: 0 on success, exits with 1 on failure
deploy_stack() {
    local stack_name=$1
    local template_file=$2
    shift 2
    local params=("$@")
    
    echo "=========================================="
    echo "Deploying stack: $stack_name"
    echo "Template: $template_file"
    if [ ${#params[@]} -gt 0 ]; then
        echo "Parameters: ${params[*]}"
    fi
    echo "=========================================="
    
    # If debug mode, print the full command
    if [ "$DEBUG" = true ]; then
        echo ""
        echo "DEBUG: Full command to be executed:"
        echo "----------------------------------------"
        if [ ${#params[@]} -gt 0 ]; then
            echo "aws cloudformation deploy \\"
            echo "  --template-file $template_file \\"
            echo "  --stack-name $stack_name \\"
            echo "  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \\"
            echo "  --parameter-overrides \\"
            for param in "${params[@]}"; do
                echo "    \"$param\" \\"
            done | sed '$ s/ \\$//'
        else
            echo "aws cloudformation deploy \\"
            echo "  --template-file $template_file \\"
            echo "  --stack-name $stack_name \\"
            echo "  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM"
        fi
        echo "----------------------------------------"
        echo ""
    fi
    
    # Deploy the stack
    if [ ${#params[@]} -gt 0 ]; then
        aws cloudformation deploy \
            --template-file "$template_file" \
            --stack-name "$stack_name" \
            --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
            --no-fail-on-empty-changeset \
            --parameter-overrides "${params[@]}"
    else
        aws cloudformation deploy \
            --template-file "$template_file" \
            --stack-name "$stack_name" \
            --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
            --no-fail-on-empty-changeset
    fi
    
    # Check if deployment command succeeded
    if [ $? -ne 0 ]; then
        echo "Error: Stack deployment failed for $stack_name"
        echo "Check CloudFormation console for detailed error information"
        echo ""
        echo "Attempting to retrieve stack events for troubleshooting..."
        aws cloudformation describe-stack-events \
            --stack-name "$stack_name" \
            --max-items 10 \
            --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
            --output table 2>/dev/null || echo "Could not retrieve stack events"
        exit 1
    fi
    
    echo "Waiting for stack to complete: $stack_name"
    
    # Wait for stack creation or update to complete
    # Try create-complete first, then update-complete if stack already exists
    aws cloudformation wait stack-create-complete --stack-name "$stack_name" 2>/dev/null || \
    aws cloudformation wait stack-update-complete --stack-name "$stack_name" 2>/dev/null
    
    # Check if wait command succeeded
    if [ $? -ne 0 ]; then
        echo "Error: Stack did not complete successfully: $stack_name"
        echo "Stack may have failed or timed out. Check CloudFormation console for details."
        exit 1
    fi
    
    echo "Stack deployment completed successfully: $stack_name"
    echo ""
    
    return 0
}

# Function: get_stack_output
# Purpose: Extract a specific output value from a CloudFormation stack
# Parameters:
#   $1 - Stack name
#   $2 - Output key
# Returns: Output value (echoed to stdout), or empty string if not found
get_stack_output() {
    local stack_name=$1
    local output_key=$2
    
    local output_value=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
        --output text 2>/dev/null)
    
    # Check if the command failed or returned empty
    if [ $? -ne 0 ]; then
        echo "Warning: Failed to retrieve output '$output_key' from stack '$stack_name'" >&2
        echo ""
        return 1
    fi
    
    if [ -z "$output_value" ] || [ "$output_value" = "None" ]; then
        echo "Warning: Output '$output_key' not found in stack '$stack_name'" >&2
        echo ""
        return 1
    fi
    
    echo "$output_value"
    return 0
}

# Function: build_parameters
# Purpose: Build a parameter string for CloudFormation deployment
# Parameters: Key-value pairs as arguments (e.g., "Key1=Value1" "Key2=Value2")
# Returns: Space-separated parameter string
build_parameters() {
    local params=""
    
    for param in "$@"; do
        # Only add non-empty parameters
        if [ -n "$param" ]; then
            params="$params $param"
        fi
    done
    
    # Trim leading/trailing whitespace
    echo "$params" | xargs
}

# Function: rollback_deployment
# Purpose: Delete stacks in reverse dependency order
# Parameters:
#   $1 - Base stack name
# Returns: 0 on success
rollback_deployment() {
    local base_name=$1
    
    echo "=========================================="
    echo "Rolling back deployment..."
    echo "=========================================="
    
    # Define stacks in reverse dependency order
    local stacks=(
        "$base_name-cloudfront"
        "$base_name-cloudfront-waf"
        "$base_name-apigateway"
        "$base_name-cicd"
        "$base_name-config-api"
        "$base_name-cognito"
        "$base_name-bedrock"
        "$base_name-foundation"
    )
    
    for stack in "${stacks[@]}"; do
        # Special handling for cloudfront-waf stack (must be deleted from us-east-1)
        if [[ "$stack" == *"-cloudfront-waf" ]]; then
            if aws cloudformation describe-stacks --stack-name "$stack" --region us-east-1 &>/dev/null; then
                STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "$stack" --region us-east-1 --query 'Stacks[0].StackStatus' --output text 2>/dev/null)
                
                if [ "$STACK_STATUS" = "REVIEW_IN_PROGRESS" ]; then
                    echo "Stack $stack is in REVIEW_IN_PROGRESS state, deleting change set first..."
                    CHANGE_SET=$(aws cloudformation list-change-sets --stack-name "$stack" --region us-east-1 --query 'Summaries[0].ChangeSetName' --output text 2>/dev/null)
                    if [ -n "$CHANGE_SET" ] && [ "$CHANGE_SET" != "None" ]; then
                        echo "Deleting change set: $CHANGE_SET"
                        aws cloudformation delete-change-set --stack-name "$stack" --region us-east-1 --change-set-name "$CHANGE_SET" 2>/dev/null || true
                    fi
                fi
                
                echo "Deleting stack: $stack (in us-east-1)"
                aws cloudformation delete-stack --stack-name "$stack" --region us-east-1
                
                if [ $? -eq 0 ]; then
                    echo "Waiting for stack deletion: $stack"
                    aws cloudformation wait stack-delete-complete --stack-name "$stack" --region us-east-1
                    
                    if [ $? -eq 0 ]; then
                        echo "Successfully deleted stack: $stack"
                    else
                        echo "Warning: Stack deletion may have failed or timed out: $stack"
                    fi
                else
                    echo "Warning: Failed to initiate deletion for stack: $stack"
                fi
            else
                echo "Stack does not exist (skipping): $stack"
            fi
            continue
        fi
        
        # Check if stack exists
        if aws cloudformation describe-stacks --stack-name "$stack" &>/dev/null; then
            # Check if stack is in REVIEW_IN_PROGRESS state
            STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "$stack" --query 'Stacks[0].StackStatus' --output text 2>/dev/null)
            
            if [ "$STACK_STATUS" = "REVIEW_IN_PROGRESS" ]; then
                echo "Stack $stack is in REVIEW_IN_PROGRESS state, deleting change set first..."
                # Get the change set name
                CHANGE_SET=$(aws cloudformation list-change-sets --stack-name "$stack" --query 'Summaries[0].ChangeSetName' --output text 2>/dev/null)
                if [ -n "$CHANGE_SET" ] && [ "$CHANGE_SET" != "None" ]; then
                    echo "Deleting change set: $CHANGE_SET"
                    aws cloudformation delete-change-set --stack-name "$stack" --change-set-name "$CHANGE_SET" 2>/dev/null || true
                fi
            fi
            
            echo "Deleting stack: $stack"
            aws cloudformation delete-stack --stack-name "$stack"
            
            if [ $? -eq 0 ]; then
                echo "Waiting for stack deletion: $stack"
                aws cloudformation wait stack-delete-complete --stack-name "$stack"
                
                if [ $? -eq 0 ]; then
                    echo "Successfully deleted stack: $stack"
                else
                    echo "Warning: Stack deletion may have failed or timed out: $stack"
                fi
            else
                echo "Warning: Failed to initiate deletion for stack: $stack"
            fi
        else
            echo "Stack does not exist (skipping): $stack"
        fi
    done
    
    echo "Rollback completed"
    echo ""
    
    return 0
}

# Function: load_vpc_config
# Purpose: Load VPC endpoint configuration from vpc-config.json
# Parameters:
#   $1 - Config file path
# Sets global variables: VPC_CONFIG_VPC_ID, VPCE_ID_*, VPCE_URL_*
# Returns: 0 on success, 1 on failure
load_vpc_config() {
    local config_file="$1"

    if [ ! -f "$config_file" ]; then
        echo "VPC config file not found: $config_file"
        return 1
    fi

    echo "Loading VPC endpoint configuration from: $config_file"

    # Read vpcId from config
    VPC_CONFIG_VPC_ID=$(python3 -c "import json; d=json.load(open('$config_file')); print(d.get('vpcId', ''))" 2>/dev/null)

    # Read VPCE DNS URLs directly from config
    local vpce_keys=("executeApi" "dynamodb" "bedrock" "bedrockRuntime" "bedrockAgent" "bedrockAgentRuntime" "s3")

    for key in "${vpce_keys[@]}"; do
        local vpce_url
        vpce_url=$(python3 -c "import json; d=json.load(open('$config_file')); print(d.get('vpceUrls', {}).get('$key', ''))" 2>/dev/null)

        # Store the URL (prepend https:// if non-empty and missing scheme)
        if [ -n "$vpce_url" ]; then
            if [[ "$vpce_url" != https://* ]]; then
                vpce_url="https://${vpce_url}"
            fi
            eval "VPCE_URL_${key}='${vpce_url}'"
        else
            eval "VPCE_URL_${key}=''"
        fi
    done

    # Extract VPCE ID from execute-api URL for API Gateway resource policy
    # DNS format: vpce-XXXXX-YYYY.execute-api.region.vpce.amazonaws.com
    if [ -n "$VPCE_URL_executeApi" ]; then
        VPCE_ID_executeApi=$(echo "$VPCE_URL_executeApi" | sed -n 's|^https://\(vpce-[a-f0-9]*\).*|\1|p')
    else
        VPCE_ID_executeApi=""
    fi

    return 0
}

# Function: validate_vpc_config
# Purpose: Check if all VPC/VPCE fields are populated, warn and pause if not
# Returns: 0 to continue, exits on user decline
validate_vpc_config() {
    local missing_fields=()

    if [ -z "$VPC_CONFIG_VPC_ID" ]; then
        missing_fields+=("vpcId")
    fi

    local vpce_keys=("executeApi" "dynamodb" "bedrock" "bedrockRuntime" "bedrockAgent" "bedrockAgentRuntime" "s3")
    for key in "${vpce_keys[@]}"; do
        local var_name="VPCE_URL_${key}"
        local val="${!var_name}"
        if [ -z "$val" ]; then
            missing_fields+=("vpceUrls.$key")
        fi
    done

    if [ ${#missing_fields[@]} -gt 0 ]; then
        echo ""
        echo "=========================================="
        echo "WARNING: Incomplete VPC endpoint configuration"
        echo "=========================================="
        echo "The following fields in vpc-config.json are empty:"
        for field in "${missing_fields[@]}"; do
            echo "  - $field"
        done
        echo ""
        echo "Services without a VPCE will use default AWS endpoints."
        echo ""

        while true; do
            read -p "Continue with incomplete VPC configuration? (yes/no): " yn
            case $yn in
                [Yy]* ) break ;;
                [Nn]* )
                    echo "Deployment cancelled. Please populate vpc-config.json and try again."
                    exit 1
                    ;;
                * ) echo "Please answer yes or no." ;;
            esac
        done
    fi

    return 0
}

# Detect the AWS region and set IS_GOVCLOUD flag
detect_region

# Parse command line arguments
ROLLBACK=false
DEBUG=false
while [[ $# -gt 0 ]]; do
  key="$1"
  case $key in
    --model-id)
    MODEL_ID="$2"
    shift
    shift
    ;;
    --stack-name)
    STACK_NAME="$2"
    shift
    shift
    ;;
    --agent-name)
    AGENT_NAME="$2"
    shift
    shift
    ;;
    --kb-name)
    KB_NAME="$2"
    shift
    shift
    ;;
    --email-domain)
    EMAIL_DOMAIN="$2"
    shift
    shift
    ;;
    --api-gateway-name)
    API_GATEWAY_NAME="$2"
    shift
    shift
    ;;
    --stream-responses)
    STREAM_RESPONSES="$2"
    shift
    shift
    ;;
    --model-name)
    MODEL_NAME="$2"
    shift
    shift
    ;;
    --model-provider)
    MODEL_PROVIDER="$2"
    shift
    shift
    ;;
    --chat-type)
    CHAT_TYPE="$2"
    shift
    shift
    ;;
    --max-tokens)
    MAX_TOKENS="$2"
    shift
    shift
    ;;
    --guardrail-id)
    GUARDRAIL_ID="$2"
    shift
    shift
    ;;
    --guardrail-version)
    GUARDRAIL_VERSION="$2"
    shift
    shift
    ;;
    --api-gateway-endpoint-type)
    API_GATEWAY_ENDPOINT_TYPE="$2"
    shift
    shift
    ;;
    --vpc-id)
    VPC_ID="$2"
    shift
    shift
    ;;
    --vpc-config)
    VPC_CONFIG_FILE="$2"
    shift
    shift
    ;;
    --rollback)
    ROLLBACK=true
    shift
    ;;
    --debug)
    DEBUG=true
    shift
    ;;
    *)
    shift
    ;;
  esac
done

# Handle rollback if requested
if [ "$ROLLBACK" = true ]; then
    if [ -z "$STACK_NAME" ]; then
        echo "Error: --stack-name is required for rollback"
        exit 1
    fi
    rollback_deployment "$STACK_NAME"
    exit 0
fi

# Validate stack name
if [ -z "$STACK_NAME" ]; then
  echo "Error: --stack-name is required"
  echo "Usage: ./deploy.sh --stack-name <name> --email-domain <domain> [options]"
  echo ""
  echo "Required:"
  echo "  --stack-name <name>           Base name for all stacks (max 12 characters)"
  echo "  --email-domain <domain>       Email domain for user registration (e.g., example.com)"
  echo ""
  echo "Optional:"
  echo "  --model-id <id>                       Bedrock foundation model ID"
  echo "  --agent-name <name>                   Name for the Bedrock Agent"
  echo "  --kb-name <name>                      Name for the Knowledge Base"
  echo "  --api-gateway-name <name>             Name for API Gateway (GovCloud only)"
  echo "  --api-gateway-endpoint-type <type>    API Gateway endpoint type: REGIONAL or PRIVATE"
  echo "                                        (GovCloud only, case-insensitive, default: REGIONAL)"
  echo "  --vpc-id <vpc-id>                     VPC ID for PRIVATE API Gateway endpoint (required when type is PRIVATE)"
  echo "  --vpc-config <path>                   Path to VPC endpoint config file (default: vpc-config.json)"
  echo "  --stream-responses <bool>             Stream responses (true/false)"
  echo "  --model-name <name>                   Bedrock model name (default: empty)"
  echo "  --model-provider <provider>           Bedrock model provider (default: Anthropic)"
  echo "  --chat-type <type>                    Bedrock chat type (default: LLM)"
  echo "  --max-tokens <number>                 Bedrock max tokens (default: 4096)"
  echo "  --guardrail-id <id>                   Bedrock guardrail ID (default: empty)"
  echo "  --guardrail-version <version>         Bedrock guardrail version (default: empty)"
  echo "  --debug                               Print full CloudFormation commands (for debugging)"
  echo "  --rollback                            Delete all stacks (cleanup)"
  exit 1
fi

if [ ${#STACK_NAME} -gt 12 ]; then
  echo "Error: Stack name is too long (${#STACK_NAME} characters). It must be 12 characters or less to prevent OpenSearch Collection creation failure."
  exit 1
fi

# Validate required email domain
if [ -z "$EMAIL_DOMAIN" ] && [ "$ROLLBACK" != true ]; then
  echo "Error: --email-domain is required for deployment"
  echo "Example: --email-domain example.com"
  exit 1
fi

# Set default values for optional parameters
if [ -z "$AGENT_NAME" ]; then
  AGENT_NAME="$STACK_NAME-agent"
fi

if [ -z "$KB_NAME" ]; then
  KB_NAME="$STACK_NAME-kb"
fi

if [ -z "$MODEL_ID" ]; then
  if [ "$IS_GOVCLOUD" = true ]; then
    MODEL_ID=$GOV_MODEL_ID
  else
    MODEL_ID=$COM_MODEL_ID
  fi
fi

if [ -z "$API_GATEWAY_NAME" ]; then
  API_GATEWAY_NAME="$STACK_NAME-api"
fi

if [ -z "$STREAM_RESPONSES" ]; then
  STREAM_RESPONSES="true"
fi

if [ -z "$MODEL_NAME" ]; then
  MODEL_NAME=""
fi

if [ -z "$MODEL_PROVIDER" ]; then
  MODEL_PROVIDER="Anthropic"
fi

if [ -z "$CHAT_TYPE" ]; then
  CHAT_TYPE="LLM"
fi

if [ -z "$MAX_TOKENS" ]; then
  MAX_TOKENS="4096"
fi

if [ -z "$GUARDRAIL_ID" ]; then
  GUARDRAIL_ID=""
fi

if [ -z "$GUARDRAIL_VERSION" ]; then
  GUARDRAIL_VERSION=""
fi

# Initialize all VPCE URL variables to empty
VPCE_URL_executeApi=""
VPCE_URL_dynamodb=""
VPCE_URL_bedrock=""
VPCE_URL_bedrockRuntime=""
VPCE_URL_bedrockAgent=""
VPCE_URL_bedrockAgentRuntime=""
VPCE_URL_s3=""

# Load VPC endpoint configuration
if [ -z "$VPC_CONFIG_FILE" ]; then
    VPC_CONFIG_FILE="vpc-config.json"
fi

if [ -f "$VPC_CONFIG_FILE" ]; then
    load_vpc_config "$VPC_CONFIG_FILE"

    # Use VPC ID from config if --vpc-id was not provided on CLI
    if [ -z "$VPC_ID" ] && [ -n "$VPC_CONFIG_VPC_ID" ]; then
        VPC_ID="$VPC_CONFIG_VPC_ID"
        echo "Using VPC ID from vpc-config.json: $VPC_ID"
    fi

    # Validate and warn about incomplete configuration
    validate_vpc_config
fi

# Handle API Gateway endpoint type for GovCloud deployments
if [ "$IS_GOVCLOUD" = true ]; then
  if [ -z "$API_GATEWAY_ENDPOINT_TYPE" ]; then
    echo ""
    echo "API Gateway endpoint type not specified."
    echo "Please select an endpoint type (REGIONAL or PRIVATE)."
    echo ""

    while true; do
      read -p "Enter API Gateway endpoint type [REGIONAL]: " user_input

      # Use REGIONAL as default if user just presses enter
      if [ -z "$user_input" ]; then
        API_GATEWAY_ENDPOINT_TYPE="REGIONAL"
        break
      fi

      # Convert to uppercase for comparison
      user_input_upper=$(echo "$user_input" | tr '[:lower:]' '[:upper:]')

      # Validate input
      if [ "$user_input_upper" = "REGIONAL" ] || [ "$user_input_upper" = "PRIVATE" ]; then
        API_GATEWAY_ENDPOINT_TYPE="$user_input_upper"
        break
      else
        echo "Invalid input. Please enter either REGIONAL or PRIVATE."
      fi
    done

    echo "API Gateway endpoint type set to: $API_GATEWAY_ENDPOINT_TYPE"
    echo ""
  else
    # Convert provided flag value to uppercase
    API_GATEWAY_ENDPOINT_TYPE=$(echo "$API_GATEWAY_ENDPOINT_TYPE" | tr '[:lower:]' '[:upper:]')

    # Validate the provided value
    if [ "$API_GATEWAY_ENDPOINT_TYPE" != "REGIONAL" ] && [ "$API_GATEWAY_ENDPOINT_TYPE" != "PRIVATE" ]; then
      echo "Error: Invalid API Gateway endpoint type '$API_GATEWAY_ENDPOINT_TYPE'"
      echo "Valid values are: REGIONAL or PRIVATE (case-insensitive)"
      exit 1
    fi
  fi

  # Validate VPC ID is provided for PRIVATE endpoint type
  if [ "$API_GATEWAY_ENDPOINT_TYPE" = "PRIVATE" ]; then
    if [ -z "$VPC_ID" ]; then
      echo "Error: --vpc-id is required when API Gateway endpoint type is PRIVATE"
      echo "Please provide a VPC ID using --vpc-id <vpc-id>"
      exit 1
    fi
    echo "VPC ID for PRIVATE endpoint: $VPC_ID"
  fi
fi

echo "=========================================="
echo "AWS Bedrock Agent Chatbot Deployment"
echo "=========================================="
echo "Region: $REGION"
echo "Stack Name: $STACK_NAME"
echo "Agent Name: $AGENT_NAME"
echo "Knowledge Base Name: $KB_NAME"
echo "Model ID: $MODEL_ID"
echo "Email Domain: $EMAIL_DOMAIN"
echo "Stream Responses: $STREAM_RESPONSES"
echo "GovCloud: $IS_GOVCLOUD"
if [ "$IS_GOVCLOUD" = true ]; then
  echo "API Gateway Name: $API_GATEWAY_NAME"
  echo "API Gateway Endpoint Type: $API_GATEWAY_ENDPOINT_TYPE"
  if [ "$API_GATEWAY_ENDPOINT_TYPE" = "PRIVATE" ] && [ -n "$VPC_ID" ]; then
    echo "VPC ID: $VPC_ID"
  fi
fi
if [ -n "$VPCE_URL_executeApi" ] || [ -n "$VPCE_URL_dynamodb" ] || [ -n "$VPCE_URL_bedrock" ]; then
  echo "VPC Endpoints:"
  [ -n "$VPCE_URL_executeApi" ] && echo "  Execute API: $VPCE_URL_executeApi"
  [ -n "$VPCE_URL_dynamodb" ] && echo "  DynamoDB: $VPCE_URL_dynamodb"
  [ -n "$VPCE_URL_bedrock" ] && echo "  Bedrock: $VPCE_URL_bedrock"
  [ -n "$VPCE_URL_bedrockRuntime" ] && echo "  Bedrock Runtime: $VPCE_URL_bedrockRuntime"
  [ -n "$VPCE_URL_bedrockAgent" ] && echo "  Bedrock Agent: $VPCE_URL_bedrockAgent"
  [ -n "$VPCE_URL_bedrockAgentRuntime" ] && echo "  Bedrock Agent Runtime: $VPCE_URL_bedrockAgentRuntime"
  [ -n "$VPCE_URL_s3" ] && echo "  S3: $VPCE_URL_s3"
fi
echo "=========================================="
echo ""

# Validate prerequisites
echo "Validating prerequisites..."

# Check AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed"
    echo "Please install AWS CLI: https://aws.amazon.com/cli/"
    exit 1
fi

# Check AWS credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "Error: AWS credentials are not configured or invalid"
    echo "Please configure AWS CLI: aws configure"
    exit 1
fi

echo "Prerequisites validated successfully"
echo ""

# Generate a unique suffix for S3 bucket names (deterministic hash of account ID)
# This avoids exposing the AWS account ID in bucket names while remaining stable across deploys
ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text 2>/dev/null)
if [ -z "$ACCOUNT_ID" ]; then
    echo "Error: Could not determine AWS account ID. Check your credentials."
    exit 1
fi
UNIQUE_SUFFIX=$(echo -n "${ACCOUNT_ID}" | sha256sum | cut -c1-8)
echo "Unique suffix for resource names: $UNIQUE_SUFFIX"
echo ""

# Prompt for model access confirmation
echo "This deployment will use the Bedrock model: $MODEL_ID"
echo "Please ensure you have enabled this model in the $REGION region before proceeding."

while true; do
  read -p "Have you enabled the $MODEL_ID model? (yes/no): " yn
  case $yn in
    [Yy]* ) 
      break
      ;;
    [Nn]* ) 
      echo "Please enable the $MODEL_ID model and run this script again."
      echo "You can enable models in the AWS Bedrock console under 'Model access'."
      exit 1
      ;;
    * ) echo "Please answer yes or no.";;
  esac
done

echo ""

# Lambda layer zip file names
#LAMBDA_LAYER_NODEJS_ZIP="lambda_layer_nodejs.zip"
LAMBDA_LAYER_PYTHON_ZIP="lambda_layer_py313.zip"

# Update Cognito template for GovCloud if needed
if [ "$IS_GOVCLOUD" = true ]; then
  if [[ "$REGION" == us-gov-east-1 ]]; then
    echo "Updating Cognito Service Principal for us-gov-east-1..."
    COGNITO_SERVICE_PRINCIPAL="cognito-identity.us-gov-east-1.amazonaws.com"
  else
    echo "Updating Cognito Service Principal for us-gov-west-1..."
    COGNITO_SERVICE_PRINCIPAL="cognito-identity-us-gov.amazonaws.com"
  fi
else
  echo "Updating Cognito Service Principal for Commercial AWS..."
  COGNITO_SERVICE_PRINCIPAL="cognito-identity.amazonaws.com"
fi

echo ""

# Step 1: Deploy Foundation stack (includes S3 buckets)
echo "=========================================="
echo "Step 1: Deploying Foundation stack"
echo "=========================================="

deploy_stack "$STACK_NAME-foundation" "CloudFormation/foundation.yaml" \
  "UniqueSuffix=$UNIQUE_SUFFIX"

# Extract Foundation stack outputs
echo "Extracting Foundation stack outputs..."
DYNAMODB_KMS_KEY_ID=$(get_stack_output "$STACK_NAME-foundation" "DynamoDBKMSKeyId")
DYNAMODB_KMS_KEY_ARN=$(get_stack_output "$STACK_NAME-foundation" "DynamoDBKMSKeyArn")
S3_KMS_KEY_ID=$(get_stack_output "$STACK_NAME-foundation" "S3KMSKeyId")
S3_KMS_KEY_ARN=$(get_stack_output "$STACK_NAME-foundation" "S3KMSKeyArn")
S3_ACCESS_LOGS_BUCKET=$(get_stack_output "$STACK_NAME-foundation" "S3AccessLogsBucket")
LAMBDA_DLQ_ARN=$(get_stack_output "$STACK_NAME-foundation" "LambdaDLQArn")
BEDROCK_AGENT_KMS_KEY_ARN=$(get_stack_output "$STACK_NAME-foundation" "BedrockKMSKeyArn")
LAMBDA_KMS_KEY_ARN=$(get_stack_output "$STACK_NAME-foundation" "LambdaKMSKeyArn")
CLOUDWATCH_LOGS_KMS_KEY_ARN=$(get_stack_output "$STACK_NAME-foundation" "CloudWatchLogsKMSKeyArn")
LAYER_BUCKET=$(get_stack_output "$STACK_NAME-foundation" "LambdaLayerBucket")
CODE_BUCKET=$(get_stack_output "$STACK_NAME-foundation" "ReactCodeBucket")
CFN_TEMPLATES_BUCKET=$(get_stack_output "$STACK_NAME-foundation" "CloudFormationTemplatesBucket")

echo "Foundation stack outputs:"
echo "  DynamoDB KMS Key ID: $DYNAMODB_KMS_KEY_ID"
echo "  S3 KMS Key ID: $S3_KMS_KEY_ID"
echo "  S3 Access Logs Bucket: $S3_ACCESS_LOGS_BUCKET"
echo "  Lambda DLQ ARN: $LAMBDA_DLQ_ARN"
echo "  Bedrock KMS Key ARN: $BEDROCK_AGENT_KMS_KEY_ARN"
echo "  Lambda KMS Key ARN: $LAMBDA_KMS_KEY_ARN"
echo "  CloudWatch Logs KMS Key ARN: $CLOUDWATCH_LOGS_KMS_KEY_ARN"
echo "  Lambda Layer Bucket: $LAYER_BUCKET"
echo "  React Code Bucket: $CODE_BUCKET"
echo "  CloudFormation Templates Bucket: $CFN_TEMPLATES_BUCKET"
echo ""

# Extract Foundation stack outputs for consolidated buckets
echo "Extracting Foundation stack outputs for consolidated buckets..."
PERSONA_S3_BUCKET=$(get_stack_output "$STACK_NAME-foundation" "PersonaS3Bucket")
PERSONA_S3_BUCKET_ARN=$(get_stack_output "$STACK_NAME-foundation" "PersonaS3BucketArn")
KB_S3_BUCKET=$(get_stack_output "$STACK_NAME-foundation" "KnowledgeBaseS3Bucket")
KB_S3_BUCKET_ARN=$(get_stack_output "$STACK_NAME-foundation" "KnowledgeBaseS3BucketArn")
UI_CODE_S3_BUCKET=$(get_stack_output "$STACK_NAME-foundation" "UICodeS3Bucket")
UI_CODE_S3_BUCKET_ARN=$(get_stack_output "$STACK_NAME-foundation" "UICodeS3BucketArn")
UI_CODE_S3_BUCKET_DOMAIN=$(get_stack_output "$STACK_NAME-foundation" "UICodeS3BucketDomainName")

# Validate that all bucket outputs are non-empty
if [ -z "$PERSONA_S3_BUCKET" ] || [ "$PERSONA_S3_BUCKET" = "None" ]; then
  echo "Error: Failed to retrieve PersonaS3Bucket name from Foundation stack"
  exit 1
fi

if [ -z "$PERSONA_S3_BUCKET_ARN" ] || [ "$PERSONA_S3_BUCKET_ARN" = "None" ]; then
  echo "Error: Failed to retrieve PersonaS3Bucket ARN from Foundation stack"
  exit 1
fi

if [ -z "$KB_S3_BUCKET" ] || [ "$KB_S3_BUCKET" = "None" ]; then
  echo "Error: Failed to retrieve KnowledgeBaseS3Bucket name from Foundation stack"
  exit 1
fi

if [ -z "$KB_S3_BUCKET_ARN" ] || [ "$KB_S3_BUCKET_ARN" = "None" ]; then
  echo "Error: Failed to retrieve KnowledgeBaseS3Bucket ARN from Foundation stack"
  exit 1
fi

if [ -z "$UI_CODE_S3_BUCKET" ] || [ "$UI_CODE_S3_BUCKET" = "None" ]; then
  echo "Error: Failed to retrieve UICodeS3Bucket name from Foundation stack"
  exit 1
fi

if [ -z "$UI_CODE_S3_BUCKET_ARN" ] || [ "$UI_CODE_S3_BUCKET_ARN" = "None" ]; then
  echo "Error: Failed to retrieve UICodeS3Bucket ARN from Foundation stack"
  exit 1
fi

if [ -z "$UI_CODE_S3_BUCKET_DOMAIN" ] || [ "$UI_CODE_S3_BUCKET_DOMAIN" = "None" ]; then
  echo "Error: Failed to retrieve UICodeS3Bucket regional domain name from Foundation stack"
  exit 1
fi

echo "Foundation stack consolidated bucket outputs:"
echo "  Persona S3 Bucket: $PERSONA_S3_BUCKET"
echo "  Persona S3 Bucket ARN: $PERSONA_S3_BUCKET_ARN"
echo "  Knowledge Base S3 Bucket: $KB_S3_BUCKET"
echo "  Knowledge Base S3 Bucket ARN: $KB_S3_BUCKET_ARN"
echo "  UI Code S3 Bucket: $UI_CODE_S3_BUCKET"
echo "  UI Code S3 Bucket ARN: $UI_CODE_S3_BUCKET_ARN"
echo "  UI Code S3 Bucket Domain: $UI_CODE_S3_BUCKET_DOMAIN"
echo ""

# Step 2: Upload Lambda layers
echo "=========================================="
echo "Step 2: Uploading Lambda layers"
echo "=========================================="

# Upload Node.js layer for API Lambda functions
# if [ -f "$LAMBDA_LAYER_NODEJS_ZIP" ]; then
#   echo "Uploading Node.js Lambda layer zip file to $LAYER_BUCKET"
#   aws s3 cp $LAMBDA_LAYER_NODEJS_ZIP s3://$LAYER_BUCKET/
#   echo "Node.js Lambda layer uploaded successfully"
# else
#   echo "Error: Node.js Lambda layer zip file $LAMBDA_LAYER_NODEJS_ZIP not found"
#   exit 1
# fi

# Upload Python layer for IndexCreator Lambda function
if [ -f "$LAMBDA_LAYER_PYTHON_ZIP" ]; then
  echo "Uploading Python Lambda layer zip file to $LAYER_BUCKET"
  aws s3 cp $LAMBDA_LAYER_PYTHON_ZIP s3://$LAYER_BUCKET/
  echo "Python Lambda layer uploaded successfully"
else
  echo "Error: Python Lambda layer zip file $LAMBDA_LAYER_PYTHON_ZIP not found"
  exit 1
fi

echo ""

# Step 3: Deploy Bedrock stack
echo "=========================================="
echo "Step 3: Deploying Bedrock stack"
echo "=========================================="

deploy_stack "$STACK_NAME-bedrock" "CloudFormation/bedrock.yaml" \
  "DynamoDBKMSKeyId=$DYNAMODB_KMS_KEY_ID" \
  "S3KMSKeyId=$S3_KMS_KEY_ID" \
  "S3AccessLogsBucket=$S3_ACCESS_LOGS_BUCKET" \
  "LambdaDLQArn=$LAMBDA_DLQ_ARN" \
  "BedrockKMSKeyArn=$BEDROCK_AGENT_KMS_KEY_ARN" \
  "LambdaKMSKeyArn=$LAMBDA_KMS_KEY_ARN" \
  "PersonaS3BucketName=$PERSONA_S3_BUCKET" \
  "PersonaS3BucketArn=$PERSONA_S3_BUCKET_ARN" \
  "KnowledgeBaseS3BucketName=$KB_S3_BUCKET" \
  "KnowledgeBaseS3BucketArn=$KB_S3_BUCKET_ARN" \
  "LambdaLayerS3BucketName=$LAYER_BUCKET" \
  "KnowledgeBaseName=$KB_NAME" \
  "KnowledgeBaseDescription=Knowledge base for $STACK_NAME chatbot" \
  "AgentName=$AGENT_NAME" \
  "AgentDescription=Bedrock agent for $STACK_NAME chatbot" \
  "AgentFoundationModel=$MODEL_ID" \
  "AgentInstruction=You are a helpful AI assistant. You will only answer based on information from your knowledge base. Never hallucinate, simply say you don't know if you don't have citable information in your knowledge base." \
  "OSSCollectionName=$STACK_NAME-oss"

# Extract Bedrock stack outputs
echo "Extracting Bedrock stack outputs..."
# PERSONA_S3_BUCKET is now retrieved from Foundation stack (see above)
# PERSONA_S3_BUCKET_ARN is now retrieved from Foundation stack (see above)
# KB_S3_BUCKET is now retrieved from Foundation stack (see above)
# KB_S3_BUCKET_ARN is now retrieved from Foundation stack (see above)
AGENT_ID=$(get_stack_output "$STACK_NAME-bedrock" "AgentId")
AGENT_ALIAS_ID=$(get_stack_output "$STACK_NAME-bedrock" "AgentAliasId")
# CloudFormation Ref for AgentAlias returns "AgentId|AliasId" - extract just the AliasId
if [[ "$AGENT_ALIAS_ID" == *"|"* ]]; then
  AGENT_ALIAS_ID="${AGENT_ALIAS_ID##*|}"
fi
AGENT_ROLE_ARN=$(get_stack_output "$STACK_NAME-bedrock" "AgentRoleArn")
KB_ID=$(get_stack_output "$STACK_NAME-bedrock" "BedrockKnowledgeBaseId")
DATASOURCE_ID=$(get_stack_output "$STACK_NAME-bedrock" "BedrockDataSourceId")

echo "Bedrock stack outputs:"
echo "  Knowledge Base S3 Bucket: $KB_S3_BUCKET"
echo "  Persona S3 Bucket: $PERSONA_S3_BUCKET"
echo "  Agent ID: $AGENT_ID"
echo "  Knowledge Base ID: $KB_ID"
echo "  Data Source ID: $DATASOURCE_ID"
echo ""

# Step 4: Deploy Cognito stack
echo "=========================================="
echo "Step 4: Deploying Cognito stack"
echo "=========================================="

deploy_stack "$STACK_NAME-cognito" "CloudFormation/cognito.yaml" \
  "CognitoPrincipal=$COGNITO_SERVICE_PRINCIPAL" \
  "DynamoDBKMSKeyId=$DYNAMODB_KMS_KEY_ID" \
  "DynamoDBKMSKeyArn=$DYNAMODB_KMS_KEY_ARN" \
  "S3KMSKeyArn=$S3_KMS_KEY_ARN" \
  "LambdaKMSKeyArn=$LAMBDA_KMS_KEY_ARN" \
  "LambdaDLQArn=$LAMBDA_DLQ_ARN" \
  "AgentRoleArn=$AGENT_ROLE_ARN" \
  "BedrockAgentId=$AGENT_ID" \
  "BedrockKMSKeyArn=$BEDROCK_AGENT_KMS_KEY_ARN" \
  "KnowledgeBaseId=$KB_ID" \
  "KnowledgeBaseS3Bucket=$KB_S3_BUCKET" \
  "PersonaS3Bucket=$PERSONA_S3_BUCKET" \
  "AllowedEmailDomain=$EMAIL_DOMAIN"

# Extract Cognito stack outputs
echo "Extracting Cognito stack outputs..."
COGNITO_USER_POOL_ID=$(get_stack_output "$STACK_NAME-cognito" "CognitoUserPoolId")
COGNITO_USER_POOL_CLIENT_ID=$(get_stack_output "$STACK_NAME-cognito" "CognitoUserPoolClientId")
COGNITO_IDENTITY_POOL_ID=$(get_stack_output "$STACK_NAME-cognito" "CognitoIdentityPoolId")
USER_CONV_HIST_TABLE=$(get_stack_output "$STACK_NAME-cognito" "UserConHistTable")
USER_PERSONAS_TABLE=$(get_stack_output "$STACK_NAME-cognito" "UserPersonasTable")

echo "Cognito stack outputs:"
echo "  User Pool ID: $COGNITO_USER_POOL_ID"
echo "  User Pool Client ID: $COGNITO_USER_POOL_CLIENT_ID"
echo "  Identity Pool ID: $COGNITO_IDENTITY_POOL_ID"
echo ""

# Step 5: Deploy Config API stack
echo "=========================================="
echo "Step 5: Deploying Config API stack"
echo "=========================================="

# Build Config API deployment parameters
CONFIG_API_PARAMS=(
  "LambdaKMSKeyArn=$LAMBDA_KMS_KEY_ARN"
  "CloudWatchLogsKMSKeyArn=$CLOUDWATCH_LOGS_KMS_KEY_ARN"
  "LambdaDLQArn=$LAMBDA_DLQ_ARN"
  "CognitoUserPoolId=$COGNITO_USER_POOL_ID"
  "CognitoUserPoolClientId=$COGNITO_USER_POOL_CLIENT_ID"
  "BedrockAgentId=$AGENT_ID"
  "BedrockAgentAliasId=$AGENT_ALIAS_ID"
  "BedrockAgentName=$AGENT_NAME"
  "BedrockAgentResourceRoleArn=$AGENT_ROLE_ARN"
  "BedrockKnowledgeBaseId=$KB_ID"
  "BedrockDataSourceId=$DATASOURCE_ID"
  "BedrockKnowledgeBaseS3Bucket=$KB_S3_BUCKET"
  "BedrockPersonaS3Bucket=$PERSONA_S3_BUCKET"
  "BedrockDefaultModelId=$MODEL_ID"
  "BedrockDefaultModelStream=$STREAM_RESPONSES"
  "BedrockDefaultChatType=$CHAT_TYPE"
  "BedrockDefaultModelProvider=$MODEL_PROVIDER"
  "BedrockMaxTokens=$MAX_TOKENS"
  "ConvHistoryTable=$USER_CONV_HIST_TABLE"
  "PersonaTable=$USER_PERSONAS_TABLE"
)

# Only pass optional parameters when they have non-empty values
# (SSM Parameter Store rejects empty string values)
[ -n "$MODEL_NAME" ] && CONFIG_API_PARAMS+=("BedrockDefaultModelName=$MODEL_NAME")
[ -n "$GUARDRAIL_ID" ] && CONFIG_API_PARAMS+=("BedrockGuardrailId=$GUARDRAIL_ID")
[ -n "$GUARDRAIL_VERSION" ] && CONFIG_API_PARAMS+=("BedrockGuardrailVersion=$GUARDRAIL_VERSION")
[ -n "$VPCE_URL_dynamodb" ] && CONFIG_API_PARAMS+=("VpceDynamodb=$VPCE_URL_dynamodb")
[ -n "$VPCE_URL_bedrock" ] && CONFIG_API_PARAMS+=("VpceBedrock=$VPCE_URL_bedrock")
[ -n "$VPCE_URL_bedrockRuntime" ] && CONFIG_API_PARAMS+=("VpceBedrockRuntime=$VPCE_URL_bedrockRuntime")
[ -n "$VPCE_URL_bedrockAgent" ] && CONFIG_API_PARAMS+=("VpceBedrockAgent=$VPCE_URL_bedrockAgent")
[ -n "$VPCE_URL_bedrockAgentRuntime" ] && CONFIG_API_PARAMS+=("VpceBedrockAgentRuntime=$VPCE_URL_bedrockAgentRuntime")
[ -n "$VPCE_URL_s3" ] && CONFIG_API_PARAMS+=("VpceS3=$VPCE_URL_s3")

# Add API Gateway endpoint type if set (GovCloud)
if [ -n "$API_GATEWAY_ENDPOINT_TYPE" ]; then
  CONFIG_API_PARAMS+=("APIGatewayEndpointType=$API_GATEWAY_ENDPOINT_TYPE")
fi

# Add VPC ID parameter if provided (for PRIVATE endpoint type)
if [ -n "$VPC_ID" ]; then
  CONFIG_API_PARAMS+=("VpcId=$VPC_ID")
fi

# Add Execute API VPC Endpoint ID if provided (for PRIVATE endpoint type)
if [ -n "$VPCE_ID_executeApi" ]; then
  CONFIG_API_PARAMS+=("ExecuteApiVpceId=$VPCE_ID_executeApi")
fi

deploy_stack "$STACK_NAME-config-api" "CloudFormation/config-api.yaml" "${CONFIG_API_PARAMS[@]}"

# Extract Config API stack outputs
echo "Extracting Config API stack outputs..."
CONFIG_API_ENDPOINT=$(get_stack_output "$STACK_NAME-config-api" "ConfigApiEndpoint")

echo "Config API stack outputs:"
echo "  Config API Endpoint: $CONFIG_API_ENDPOINT"
echo ""

# Step 6: Package and upload React application
echo "=========================================="
echo "Step 6: Packaging and uploading React application"
echo "=========================================="

echo "Packaging React application..."
cd ../WebApp
zip -r ../Infrastructure/reactapplication.zip public src package.json index.html vite.config.js
cd ../Infrastructure

echo "Uploading React application to $CODE_BUCKET"
aws s3 cp reactapplication.zip s3://$CODE_BUCKET/

echo "React application uploaded successfully"
echo ""

# Step 9: Deploy CICD stack
echo "=========================================="
echo "Step 7: Deploying CICD stack"
echo "=========================================="

deploy_stack "$STACK_NAME-cicd" "CloudFormation/cicd.yaml" \
  "S3KMSKeyId=$S3_KMS_KEY_ID" \
  "S3KMSKeyArn=$S3_KMS_KEY_ARN" \
  "S3AccessLogsBucket=$S3_ACCESS_LOGS_BUCKET" \
  "UICodeS3BucketName=$UI_CODE_S3_BUCKET" \
  "UICodeS3BucketArn=$UI_CODE_S3_BUCKET_ARN" \
  "UICodeS3BucketDomainName=$UI_CODE_S3_BUCKET_DOMAIN" \
  "CognitoIdentityPoolId=$COGNITO_IDENTITY_POOL_ID" \
  "CognitoUserPoolId=$COGNITO_USER_POOL_ID" \
  "CognitoUserPoolClientId=$COGNITO_USER_POOL_CLIENT_ID" \
  "ConfigApiUrl=$CONFIG_API_ENDPOINT" \
  "CodeS3BucketName=$CODE_BUCKET"

# Extract CICD stack outputs
echo "Extracting CICD stack outputs..."
# UI_CODE_S3_BUCKET is now retrieved from Foundation stack (see above)
# UI_CODE_S3_BUCKET_DOMAIN is now retrieved from Foundation stack (see above)
# UI_CODE_S3_BUCKET_ARN is now retrieved from Foundation stack (see above)

echo "CICD stack outputs:"
echo "  UI Code S3 Bucket: $UI_CODE_S3_BUCKET"
echo ""

# Step 8: Deploy CloudFront or API Gateway stack based on region
if [ "$IS_GOVCLOUD" = true ]; then
  echo "=========================================="
  echo "Step 8: Deploying API Gateway stack (GovCloud)"
  echo "=========================================="

  # Build API Gateway deployment parameters
  API_GATEWAY_PARAMS=(
    "S3KMSKeyArn=$S3_KMS_KEY_ARN"
    "CloudWatchLogsKMSKeyArn=$CLOUDWATCH_LOGS_KMS_KEY_ARN"
    "UICodeS3Bucket=$UI_CODE_S3_BUCKET"
    "APIGatewayName=$API_GATEWAY_NAME"
    "APIGatewayEndpointType=$API_GATEWAY_ENDPOINT_TYPE"
  )

  # Add VPC ID parameter if provided (for PRIVATE endpoint type)
  if [ -n "$VPC_ID" ]; then
    API_GATEWAY_PARAMS+=("VpcId=$VPC_ID")
  fi

  # Add Execute API VPC Endpoint ID if provided (for PRIVATE endpoint type)
  if [ -n "$VPCE_ID_executeApi" ]; then
    API_GATEWAY_PARAMS+=("ExecuteApiVpceId=$VPCE_ID_executeApi")
  fi

  deploy_stack "$STACK_NAME-apigateway" "CloudFormation/apigateway.yaml" "${API_GATEWAY_PARAMS[@]}"
  
  # Extract API Gateway outputs
  echo "Extracting API Gateway stack outputs..."
  API_ENDPOINT=$(get_stack_output "$STACK_NAME-apigateway" "ApiEndpoint")
  USER_URL=$(get_stack_output "$STACK_NAME-apigateway" "UserURL")
  
  echo "API Gateway stack outputs:"
  echo "  API Endpoint: $API_ENDPOINT"
  echo "  User URL: $USER_URL"
  echo ""
else
  echo "=========================================="
  echo "Step 8a: Deploying WAF WebACL in us-east-1 (Commercial AWS)"
  echo "=========================================="
  
  echo "Deploying WAF WebACL for CloudFront (must be in us-east-1)..."
  aws cloudformation deploy \
    --template-file "CloudFormation/cloudfront-waf.yaml" \
    --stack-name "$STACK_NAME-cloudfront-waf" \
    --region us-east-1 \
    --no-fail-on-empty-changeset \
    --parameter-overrides "StackName=$STACK_NAME"
  
  if [ $? -ne 0 ]; then
    echo "Error: WAF stack deployment failed"
    exit 1
  fi
  
  echo "Waiting for WAF stack to complete..."
  aws cloudformation wait stack-create-complete --stack-name "$STACK_NAME-cloudfront-waf" --region us-east-1 2>/dev/null || \
  aws cloudformation wait stack-update-complete --stack-name "$STACK_NAME-cloudfront-waf" --region us-east-1 2>/dev/null
  
  # Extract WAF WebACL ARN
  echo "Extracting WAF WebACL ARN..."
  WEB_ACL_ARN=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME-cloudfront-waf" \
    --region us-east-1 \
    --query "Stacks[0].Outputs[?OutputKey=='WebACLArn'].OutputValue" \
    --output text 2>/dev/null)
  
  if [ -z "$WEB_ACL_ARN" ] || [ "$WEB_ACL_ARN" = "None" ]; then
    echo "Warning: Failed to retrieve WebACL ARN, deploying CloudFront without WAF"
    WEB_ACL_ARN=""
  else
    echo "WAF WebACL ARN: $WEB_ACL_ARN"
  fi
  echo ""
  
  echo "=========================================="
  echo "Step 8b: Deploying CloudFront stack (Commercial AWS)"
  echo "=========================================="
  
  deploy_stack "$STACK_NAME-cloudfront" "CloudFormation/cloudfront.yaml" \
    "S3AccessLogsBucket=$S3_ACCESS_LOGS_BUCKET" \
    "S3KMSKeyId=$S3_KMS_KEY_ID" \
    "LambdaDLQArn=$LAMBDA_DLQ_ARN" \
    "LambdaKMSKeyArn=$LAMBDA_KMS_KEY_ARN" \
    "UICodeS3Bucket=$UI_CODE_S3_BUCKET" \
    "UICodeS3BucketDomainName=$UI_CODE_S3_BUCKET_DOMAIN" \
    "UICodeS3BucketArn=$UI_CODE_S3_BUCKET_ARN" \
    "WebACLArn=$WEB_ACL_ARN" \
    "UniqueSuffix=$UNIQUE_SUFFIX"
  
  # Extract CloudFront outputs
  echo "Extracting CloudFront stack outputs..."
  CLOUDFRONT_DISTRIBUTION_ID=$(get_stack_output "$STACK_NAME-cloudfront" "CloudFrontDistributionId")
  CLOUDFRONT_DOMAIN=$(get_stack_output "$STACK_NAME-cloudfront" "CloudFrontDomainName")
  
  echo "CloudFront stack outputs:"
  echo "  Distribution ID: $CLOUDFRONT_DISTRIBUTION_ID"
  echo "  Domain Name: $CLOUDFRONT_DOMAIN"
  echo "  WAF WebACL ARN: $WEB_ACL_ARN"
  echo ""
fi

# Step 9: Cleanup temporary resources
echo "=========================================="
echo "Step 9: Cleaning up temporary resources"
echo "=========================================="

echo "Deleting local React application zip..."
rm -f reactapplication.zip

echo "Cleanup completed"
echo ""

# Step 10: Start Bedrock knowledge base ingestion
echo "=========================================="
echo "Step 10: Starting Bedrock knowledge base ingestion"
echo "=========================================="

echo "Starting ingestion job for Knowledge Base: $KB_ID"
aws bedrock-agent start-ingestion-job --knowledge-base-id $KB_ID --data-source-id $DATASOURCE_ID

echo "Ingestion job started successfully"
echo ""

# Display final deployment summary
echo "=========================================="
echo "Deployment Completed Successfully!"
echo "=========================================="
echo ""
echo "Stack Name: $STACK_NAME"
echo "Region: $REGION"
echo ""
echo "Deployed Stacks:"
echo "  - $STACK_NAME-foundation (includes Lambda Layer, React Code, and CFN Templates buckets)"
echo "  - $STACK_NAME-bedrock"
echo "  - $STACK_NAME-cognito"
echo "  - $STACK_NAME-config-api"
echo "  - $STACK_NAME-cicd"
if [ "$IS_GOVCLOUD" = true ]; then
  echo "  - $STACK_NAME-apigateway"
  echo ""
  echo "Application URL: $USER_URL"
else
  echo "  - $STACK_NAME-cloudfront-waf (us-east-1)"
  echo "  - $STACK_NAME-cloudfront"
  echo ""
  echo "Application URL: https://$CLOUDFRONT_DOMAIN"
fi
echo ""
echo "Key Resources:"
echo "  - Knowledge Base ID: $KB_ID"
echo "  - Agent ID: $AGENT_ID"
echo "  - User Pool ID: $COGNITO_USER_POOL_ID"
echo "  - Identity Pool ID: $COGNITO_IDENTITY_POOL_ID"
if [ "$IS_GOVCLOUD" != true ] && [ -n "$WEB_ACL_ARN" ]; then
  echo "  - WAF WebACL ARN: $WEB_ACL_ARN"
fi
echo ""
echo "To rollback this deployment, run:"
echo "  ./deploy.sh --stack-name $STACK_NAME --rollback"
echo ""
echo "=========================================="