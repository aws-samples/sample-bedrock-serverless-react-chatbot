# Serverless Amazon Bedrock React Chatbot

This is a sample Amazon Bedrock powered serverless chatbot that's deployed through Infrastructure as Code and creates a user-friendly chatbot solution that can be deployed quickly, in both commercial and GovCloud. This solution includes conversation history functionality, allowing users to reference and continue previous interactions seamlessly. This solution incorporates Personas and Retrieval-Augmented Generation (RAG) for context-aware conversations, which means the chatbot can maintain relevant, intelligent dialogue based on specific roles and knowledge bases. Additionally, this system provides token usage estimates per conversation, giving estimated visibility into consumption metrics. Finally, this solution supports file uploads for document summarization and analysis, enabling users to extract insights from their documents directly through the chat interface.

**Note: This solution is designed for Proof of Concept (POC) usage and is not intended for production deployment.**

> **Update — Amazon S3 Vectors support for Knowledge Bases:** The Bedrock stack now supports **Amazon S3 Vectors** as the vector store backing the Amazon Bedrock Knowledge Base vector index, as an alternative to Amazon OpenSearch Serverless. Select it at deploy time with `--vector-store s3vectors` (default remains `opensearch`). With this backend, the Knowledge Base uses an S3 vector bucket and vector index for embedding storage and similarity search, which lowers cost and removes the need to manage an OpenSearch Serverless collection.
>
> **Availability:** Amazon S3 Vectors for Bedrock Knowledge Bases is currently available **only in the AWS Commercial (`aws`) partition**. It is **not yet available in AWS GovCloud (US) (`aws-us-gov`)**, so `--vector-store s3vectors` is blocked when deploying to GovCloud; use `--vector-store opensearch` there. This solution will be updated to support S3 Vectors deployments in GovCloud once the feature becomes available in that partition.

> **Update — Amazon Bedrock Managed Knowledge Base support:** The Bedrock stack now also supports **Amazon Bedrock Managed Knowledge Base**, where Bedrock owns the vector store, indexing, and retrieval infrastructure outright. Select it with `--vector-store managed`. Unlike the other two options, this creates **no vector store resources in your account** — no OpenSearch Serverless collection, no S3 vector bucket, and no index-creator Lambda. See [Choosing a Vector Store](#-choosing-a-vector-store) for the trade-offs and Regional availability.

## Table of Contents

- [Serverless Amazon Bedrock React Chatbot](#serverless-amazon-bedrock-react-chatbot)
  - [Table of Contents](#table-of-contents)
  - [✨ Features](#-features)
  - [🖥️ UI and Architecture Diagram](#️-ui-and-architecture-diagram)
  - [📁 Project Structure](#-project-structure)
  - [🚀 Deployment](#-deployment)
  - [🗂️ Choosing a Vector Store](#-choosing-a-vector-store)
  - [🔒 Deploying in an Isolated VPC with VPC Endpoints](#-deploying-in-an-isolated-vpc-with-vpc-endpoints)
    - [API Gateway Resource Policy (PRIVATE Endpoints)](#api-gateway-resource-policy-private-endpoints)
  - [🚫 Skipping RAG Infrastructure](#-skipping-rag-infrastructure)
  - [⚙️ Runtime Configuration (Config API)](#️-runtime-configuration-config-api)
  - [🔄 Redeploying the Web App](#-redeploying-the-web-app)
  - [🗑️ Tearing Down the Deployment](#️-tearing-down-the-deployment)
  - [📚 Additional Documentation](#-additional-documentation)
  - [📄 License](#-license)

## ✨ Features

- Conversational AI powered by Amazon Bedrock Agents and Knowledge Bases (RAG)
- Streaming and non-streaming response modes with markdown and syntax highlighting
- Conversation history with per-session token usage (DynamoDB-backed)
- Personas with custom instructions and document context (S3-backed)
- Knowledge base management with document upload and website crawling
- Real-time knowledge base sync and ingestion status
- Document viewer with PDF and DOCX support, including citation highlighting
- Support for multiple model selections
- Cognito-based authentication with email domain restriction
- Automated CI/CD pipeline (CodePipeline + CodeBuild) triggered on S3 upload
- CloudFront distribution with WAF, security headers, and OAC (commercial)
- API Gateway with REGIONAL or PRIVATE endpoint support (GovCloud)
- Full VPC endpoint support for isolated/private deployments
- Skip RAG mode for PRIVATE deployments that only need direct LLM access
- Selectable vector store: OpenSearch Serverless, Amazon S3 Vectors, or a fully Bedrock-managed knowledge base
- Infrastructure as Code with KMS encryption, access logging, and least-privilege IAM using only customer managed policies (no inline role policies)

## 🖥️ UI and Architecture Diagram

Example screenshot:\
![Application UI Screenshot](./CB_UI.png)

End-to-End Workflow:\
![End-to-End Workflow](./CB_E2E.png)

Architecture diagram:\
![End-to-End Architecture](./CB_SA.png)

## 📁 Project Structure

```
sample-bedrock-serverless-react-chatbot/
├── WebApp/                          # React frontend application
│   ├── src/                         # React source code
│   ├── public/                      # Static assets
│   └── package.json                 # Node.js dependencies
├── Infrastructure/                  # AWS infrastructure deployment
│   ├── CloudFormation/              # CloudFormation templates
│   │   ├── foundation.yaml          # Shared infrastructure (KMS, S3, DLQ)
│   │   ├── bedrock.yaml             # Bedrock Agent and Knowledge Base
│   │   ├── cognito.yaml             # User authentication
│   │   ├── config-api.yaml          # Config API (SSM Parameter Store, Lambda, API Gateway) - both commercial and GovCloud
│   │   ├── cicd.yaml                # CI/CD pipeline
│   │   ├── cloudfront.yaml          # CloudFront distribution (commercial)
│   │   ├── cloudfront-waf.yaml      # WAF WebACL (us-east-1 only, commercial)
│   │   └── apigateway.yaml          # API Gateway for UI hosting (GovCloud, REGIONAL or PRIVATE)
│   ├── deploy.sh                    # Main deployment script
│   ├── destroy.sh                   # Teardown script (deletes all stacks)
│   ├── lambda_layer_py313.zip       # Python dependencies for Lambda
│   ├── cors-config.json             # CORS configuration
│   └── vpc-config.json.sample       # Sample VPC endpoint configuration
```

## 🚀 Deployment

⚠ Ensure your AWS CLI has a valid session with permissions necessary for deploying CloudFormation stacks

1. Clone the repository and navigate to the Infrastructure directory.
```bash
git clone https://github.com/aws-samples/sample-bedrock-serverless-react-chatbot.git
cd sample-bedrock-serverless-react-chatbot/Infrastructure
```

2. Execute the deploy script with required parameters:
```bash
./deploy.sh --stack-name my-br-bot --email-domain example.com
```

   - `--stack-name` (required): Base name for all CloudFormation stacks (max 12 characters)
   - `--email-domain` (required): Email domain for user registration (e.g., example.com)

   **Optional parameters:**
   - `--model-id <id>` — Bedrock foundation model ID (auto-detected for commercial/GovCloud)
   - `--agent-name <name>` — Name for the Bedrock Agent
   - `--kb-name <name>` — Name for the Knowledge Base
   - `--api-gateway-name <name>` — Name for API Gateway (GovCloud only)
   - `--api-gateway-endpoint-type <type>` — `REGIONAL` or `PRIVATE` (GovCloud only, default: `REGIONAL`)
   - `--vpc-id <vpc-id>` — VPC ID (required when endpoint type is `PRIVATE`)
   - `--vpc-config <path>` — Path to VPC endpoint config file (default: `vpc-config.json`)
   - `--stream-responses <bool>` — Enable/disable streaming responses (default: `true`)
   - `--model-name <name>` — Bedrock model display name (default: empty)
   - `--model-provider <provider>` — Bedrock model provider (default: `Anthropic`)
   - `--chat-type <type>` — Default chat type: `LLM` or `RAG` (default: `LLM`)
   - `--max-tokens <number>` — Maximum tokens for model responses (default: `4096`)
   - `--guardrail-id <id>` — Bedrock Guardrail ID (default: empty)
   - `--guardrail-version <version>` — Bedrock Guardrail version (default: empty)
   - `--debug` — Print full CloudFormation commands for troubleshooting
   - `--skip-rag` — Skip RAG infrastructure (works with any endpoint type). If not provided, the script will prompt you interactively.
   - `--vector-store <type>` — Vector store for RAG: `opensearch`, `s3vectors`, or `managed` (default: `opensearch`). If not provided, the script will prompt you interactively. See [Choosing a Vector Store](#-choosing-a-vector-store).
   - `--managed-kb-embedding <type>` — Embedding model for `--vector-store managed`: `AUTO`, `MANAGED`, or `CUSTOM` (default: `AUTO`)
   - `--rollback` — Delete all stacks created by a previous deployment

3. Check the CloudFormation outputs section for your CloudFront distribution link (commercial) or API Gateway URL (GovCloud) and test out your new RAG Chatbot!

## 🗂️ Choosing a Vector Store

The Bedrock Knowledge Base can be backed by three different vector stores, selected with `--vector-store`. If you don't pass the flag, `deploy.sh` prompts you.

| | `opensearch` (default) | `s3vectors` | `managed` |
|---|---|---|---|
| Knowledge base type | Customer-managed (`VECTOR`) | Customer-managed (`VECTOR`) | Bedrock Managed (`MANAGED`) |
| Resources created in your account | OpenSearch Serverless collection, security/access policies, index-creator Lambda + layer | S3 vector bucket and vector index | None |
| Who scales the store | You | Amazon S3 | Amazon Bedrock |
| Embedding model | Titan Text Embeddings V2 | Titan Text Embeddings V2 | Service-managed by default |
| Vector store IAM permissions on the KB role | `aoss:APIAccessAll` | `s3vectors:*` on the index | None required |
| Relative cost | Highest (always-on collection) | Lower | Pay per indexed data and retrieval |

### The `managed` option

With `--vector-store managed`, Bedrock owns the entire retrieval pipeline. The stack creates only the `AWS::Bedrock::KnowledgeBase` (with `KnowledgeBaseConfiguration.Type: MANAGED` and no `StorageConfiguration`) and a connector-based data source pointing at the knowledge base S3 bucket. There is no collection to size, no index to create, and no index-creator Lambda.

This is also the least-privilege option: because there is no customer-owned vector store, the Knowledge Base service role gets **no** vector store permissions at all. When the service-managed embedding model is used, the role also needs no `bedrock:InvokeModel` permission, so its policy reduces to S3 read access on the document buckets, KMS decrypt for those buckets, and operations on its own knowledge base.

**Regional availability.** Managed knowledge bases are available in `us-east-1`, `us-west-2`, `eu-west-1`, `eu-west-2`, `eu-central-1`, `ap-northeast-1`, `ap-southeast-2`, and `us-gov-west-1`. Both `deploy.sh` and a CloudFormation `Rules` assertion in `bedrock.yaml` reject other Regions up front rather than letting the stack roll back. Update both lists as AWS expands availability.

**Embedding model.** `--managed-kb-embedding` controls which embedding model the managed knowledge base uses:

- `AUTO` (default) — `MANAGED` in commercial Regions, `CUSTOM` in GovCloud
- `MANAGED` — the service-managed embedding model. No model access required, and it enables the built-in managed reranker
- `CUSTOM` — your own Bedrock embedding model (defaults to `amazon.titan-embed-text-v2:0` at 1024 dimensions, FLOAT32). Selecting a custom embedding model makes the managed reranker unavailable

The embedding model type cannot be changed after the knowledge base is created; switching requires replacing it.

**GovCloud differences.** In `us-gov-west-1`, managed knowledge bases do not offer service-managed embedding, reranking, or agentic retrieval, and only the Amazon S3 connector is available. `AUTO` therefore resolves to `CUSTOM` there, and passing `--managed-kb-embedding MANAGED` is rejected before deployment starts.

**Encryption.** The managed vector store is encrypted with the Foundation stack's customer managed Bedrock KMS key. Bedrock creates a KMS grant on that key when the knowledge base is created and retires it on deletion, so the principal running `deploy.sh` needs `kms:CreateGrant` on the key. The Knowledge Base service role itself needs no permissions on it.

**Website crawling.** Managed knowledge bases use connector-based data sources, so the web app sends a different `CreateDataSource` shape when the deployment uses `managed`. Crawl limits map onto the managed connector's controls: *Max Pages* becomes the maximum links followed per URL (1–1000) and *Rate Limit* becomes URLs crawled per minute (1–300). The UI notes this inline.

## 🔒 Deploying in an Isolated VPC with VPC Endpoints

For environments that require private connectivity (no internet access), the solution supports deployment into an isolated VPC using VPC Endpoints (VPCEs) and a private API Gateway.

1. **Create VPC Endpoints** in your VPC for the following services:
   - `execute-api` — API Gateway
   - `dynamodb` — DynamoDB
   - `bedrock` — Bedrock
   - `bedrock-runtime` — Bedrock Runtime
   - `bedrock-agent` — Bedrock Agent
   - `bedrock-agent-runtime` — Bedrock Agent Runtime
   - `s3` — S3

2. **Create the VPC config file** from the sample:
```bash
cp Infrastructure/vpc-config.json.sample Infrastructure/vpc-config.json
```

3. **Edit `vpc-config.json`** and populate it with your VPC ID and VPCE DNS names (not the VPCE IDs). Note: for S3 interface endpoints, use the base DNS name without the `*.` wildcard prefix.

4. **Deploy with private API Gateway:**
```bash
cd Infrastructure
./deploy.sh --stack-name my-br-bot --email-domain example.com --api-gateway-endpoint-type PRIVATE
```

The script reads `vpc-config.json` automatically and passes the VPCE DNS URLs (from step 3 above) to the relevant CloudFormation stacks. The VPC ID is read from the config file, or can be overridden with `--vpc-id`.

### API Gateway Resource Policy (PRIVATE Endpoints)

When deploying with `--api-gateway-endpoint-type PRIVATE`, the API Gateway resource policy controls which traffic can invoke the API. The templates handle two scenarios:

- **VPCE ID provided** (via `vpc-config.json` or `--vpc-config`): The resource policy restricts access to requests originating from that specific VPC Endpoint (`aws:sourceVpce` condition). This is the most restrictive option.
- **VPCE ID not provided**: This covers situations where a VPC Endpoint for `execute-api` has not yet been deployed. The resource policy falls back to allowing requests from the entire VPC using the `aws:sourceVpc` condition with the VPC ID. This is less restrictive but ensures the API is accessible while VPC Endpoints are being provisioned.

For REGIONAL endpoints, no resource policy is applied.

## 🚫 Skipping RAG Infrastructure

For deployments that only need direct LLM access (no Knowledge Base or document retrieval), you can skip all RAG infrastructure. This omits the vector store, the Bedrock Knowledge Base, and the KB S3 bucket, reducing deployment time and cost. This works with any endpoint type (REGIONAL, PRIVATE, etc.).

There are two ways to enable this:

1. **CLI flag**: Pass `--skip-rag` when running `deploy.sh`:
```bash
./deploy.sh --stack-name my-br-bot --email-domain example.com --skip-rag
```

2. **Interactive prompt**: When you don't pass `--skip-rag`, the script will ask:
```
Do you want to skip RAG infrastructure? (yes/no) [no]:
```

When RAG is skipped:
- The default chat type is set to `LLM` (general chat)
- The UI hides the Knowledge Base management section (document upload, website crawler, KB sync)
- The chat type dropdown only shows "General Chat" (the RAG option is removed)

## ⚙️ Runtime Configuration (Config API)

The solution uses a Config API backed by AWS Systems Manager Parameter Store to deliver runtime configuration to the web app. This is deployed in both commercial and GovCloud regions. It eliminates the need to hardcode Bedrock, DynamoDB, and VPCE settings as environment variables in the frontend build.

> **Note:** Once Lambda streaming is supported in AWS GovCloud, all AWS service interactions will flow through API Gateway and Lambda.

The `config-api` stack deploys:
- SSM Parameters for all Bedrock, DynamoDB, and VPCE configuration values
- A Lambda function that reads all parameters and returns them as JSON
- An API Gateway (Cognito-authorized) that exposes a `GET /config` endpoint
- A WAF WebACL with rate limiting and managed rule sets
- Gateway responses with CORS headers for error responses

In commercial regions, the Config API Gateway is a separate REGIONAL API Gateway from the CloudFront distribution that serves the UI. In GovCloud, both the UI-serving API Gateway (`apigateway.yaml`) and the Config API Gateway (`config-api.yaml`) are deployed as separate REST APIs. The Config API supports the same PRIVATE endpoint configuration as the UI API Gateway when deploying in an isolated VPC.

On page load, the web app calls the Config API with the user's JWT token and caches the response in `sessionStorage`. All config values (regions, table names, model IDs, etc.) are then available at runtime via proxy objects in `aws-config.js`.

The Config API URL is set via the `VITE_CONFIG_API_URL` environment variable in `WebApp/.env.local`. The CICD stack also receives this URL and injects it during builds.

## 🔄 Redeploying the Web App

After making changes to the web app source, zip and upload to the react-code S3 bucket. The CICD pipeline (EventBridge → CodePipeline → CodeBuild) automatically triggers a build and deploys the updated files.

```bash
cd WebApp
zip -r ../Infrastructure/reactapplication.zip public src package.json index.html vite.config.js
cd ../Infrastructure
REACT_CODE_BUCKET=$(aws cloudformation describe-stacks --stack-name <stack-name>-foundation \
  --query "Stacks[0].Outputs[?OutputKey=='ReactCodeBucket'].OutputValue" --output text)
aws s3 cp reactapplication.zip s3://$REACT_CODE_BUCKET/
rm reactapplication.zip
```

Replace `<stack-name>` with your base stack name (e.g. `my-br-bot`). No manual build or CloudFront invalidation is required.

## 🗑️ Tearing Down the Deployment

To delete all resources created by `deploy.sh`, use `destroy.sh`:

```bash
cd Infrastructure
./destroy.sh --stack-name my-br-bot
```

This deletes stacks in reverse dependency order: CloudFront/API Gateway → CICD → Config API → Cognito → Bedrock → Foundation. It also empties versioned S3 buckets and cleans up retained resources.

Options:
- `--yes` or `-y` — Skip the confirmation prompt
- `--keep-retained` — Don't delete buckets with `DeletionPolicy: Retain`

Alternatively, `deploy.sh --rollback` performs the same teardown.

## 📚 Additional Documentation

- **Contributing**: See [CONTRIBUTING.md](CONTRIBUTING.md)

## 📄 License

This library is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file.