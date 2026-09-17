# Effort Levels Dynamic Configuration Update

## Summary

Replaced the hardcoded Anthropic Claude `output_config.effort` levels map with a hybrid approach:
1. **SSM Parameter Store** serves as the authoritative source, updateable without code changes
2. **ValidationException retry** automatically falls back to "high" adaptive thinking when an invalid effort level is used
3. **Session-level learning** caches rejected effort levels to avoid repeated retries

## Changes Made

### 1. Infrastructure (CloudFormation)

**File:** `Infrastructure/CloudFormation/config-api.yaml`

- Added `BedrockEffortLevels` parameter with default JSON map synchronized to AWS docs
- Created `SSMBedrockEffortLevels` parameter resource
- Updated Lambda `handle_get` to expose `effortLevels` in the `bedrockConfig` response

**Default Value:**
```json
{
  "claude-fable-5": ["low","medium","high","xhigh","max"],
  "claude-mythos-5": ["low","medium","high","xhigh","max"],
  "claude-mythos-preview": ["low","medium","high","max"],
  "claude-opus-5": ["low","medium","high","xhigh","max"],
  "claude-opus-4-7": ["low","medium","high","max"],
  "claude-opus-4-6": ["low","medium","high","xhigh","max"],
  "claude-sonnet-5": ["low","medium","high"],
  "claude-sonnet-4-6": ["low","medium","high","max"]
}
```

**Corrections from original hardcoded map:**
- Removed `claude-opus-4-8` (not documented)
- Removed `claude-opus-4-5-20251101` (Opus 4.5 doesn't support adaptive thinking per AWS docs)
- Fixed `claude-opus-4-6` to include `xhigh` (was missing)
- Fixed `claude-sonnet-5` to remove `xhigh` and `max` (not supported per AWS docs)

### 2. Frontend Logic

**File:** `WebApp/src/bedrockAgent.js`

#### Added:
1. **`effortRejectionCache`** — session-scoped Set tracking which models rejected which effort levels
2. **`recordEffortRejection(modelId, effort)`** — caches ValidationException rejections
3. **`sendWithEffortRetry(client, command, modelId, commandInput, CommandClass)`** — wrapper that:
   - Catches ValidationException when `output_config.effort` was provided
   - Logs the rejection and caches it
   - Retries once with effort removed (falls back to server-side "high" default)
   - Rethrows non-ValidationException errors immediately

#### Modified:
1. **`EFFORT_LEVELS_BY_MODEL`** → **`EFFORT_LEVELS_BY_MODEL_FALLBACK`** 
   - Serves as fallback when SSM parameter is unavailable
   - Updated values to match AWS documentation
2. **`getEffortLevelsForModel(modelId)`** — now:
   - Parses `bedrockConfig.effortLevels` from SSM (runtime)
   - Falls back to `EFFORT_LEVELS_BY_MODEL_FALLBACK` on parse error or empty value
   - Filters out any effort levels rejected in this session via `effortRejectionCache`
3. **`invokeBedrockConverseStreamCommand`** — wrapped the `bedrockClient.send(command)` call with `sendWithEffortRetry`
4. **RAG path** (`invokeBedrockRetrieveAndGenerateStreamCommand`) — wrapped the `bedrockClient.send(command)` call with `sendWithEffortRetry`

#### Unchanged:
- Managed KB RAG path already delegates to `invokeBedrockConverseStreamCommand`, so the retry is inherited
- Non-streaming `ConverseCommand` path doesn't accept effort parameter, so no change needed

## Behavior

### Before
- Effort levels were hardcoded at build time
- New models or capability changes required a code rebuild
- The map had several inaccuracies vs AWS documentation
- If a user somehow selected an invalid effort (e.g., via URL parameter), they got an error toast

### After
1. **Admin updates SSM parameter** (no redeploy):
   ```bash
   aws ssm put-parameter \
     --name "/<stack-name>/bedrock/effortLevels" \
     --value '{"claude-opus-6":["low","medium","high","xhigh","max"]}' \
     --overwrite
   ```
2. **Users refresh the browser** — next `GET /config` fetches the new map from `sessionStorage`
3. **ValidationException auto-correction** — if a user somehow gets an invalid effort:
   - First request: tries `effort=xhigh` → ValidationException → logs warning → retries with no effort (server defaults to "high") → succeeds
   - Subsequent requests: `getEffortLevelsForModel()` filters out `xhigh` from the dropdown
4. **Session learning persists** — the rejection cache lives for the browser tab lifetime

## Admin Workflow

### To Add a New Model
```bash
# 1. Fetch current config
CURRENT=$(aws ssm get-parameter \
  --name "/<stack-name>/bedrock/effortLevels" \
  --query 'Parameter.Value' \
  --output text)

# 2. Edit the JSON (add new model)
echo "$CURRENT" | jq '. + {"claude-new-model": ["low","medium","high"]}' > new-config.json

# 3. Update SSM
aws ssm put-parameter \
  --name "/<stack-name>/bedrock/effortLevels" \
  --value "$(cat new-config.json)" \
  --overwrite
```

### To Update Stack Default (Stack Update)
Update the `BedrockEffortLevels` default in `config-api.yaml` and redeploy the stack. This changes the fallback for all future deployments but doesn't affect running stacks unless the parameter is explicitly updated.

## Testing

1. **Build test passed:** `npm run build` succeeded with no errors
2. **Next steps for validation:**
   - Deploy stack update
   - Verify `GET /config` returns `bedrockConfig.effortLevels` with the JSON string
   - Select a model with effort support in the UI and confirm the dropdown populates
   - Manually test ValidationException fallback by temporarily editing the SSM parameter to include an invalid level

## References

- [AWS Adaptive Thinking Docs](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-adaptive-thinking.html)
- [Anthropic Effort Docs](https://platform.claude.com/docs/en/build-with-claude/effort)
