# Backend (FastAPI, Python 3.12 per root README). Frontend is static-hosted
# from the storage account (storage.tf), not a second App Service.
#
# CORRECTION 2026-08-19: this comment used to claim the frontend was "a
# pure client-side Vite SPA with no server-side rendering need" — checked
# directly against the actual build output and that's wrong. The frontend
# uses TanStack Start and its build produces real server-rendered route
# bundles (.output/server/), not just static files. It also defaulted to
# targeting Cloudflare Workers, confirmed to be an unconfigured scaffolding
# default (no wrangler.toml committed, no cloudflare package dependency),
# not a deliberate choice. Decision made 2026-08-19: reconfigure the build
# to produce static output instead (Nitro's `static` preset) rather than
# add new compute here — a teammate is implementing that on the frontend
# side. If that turns out not to be viable, this comment and storage.tf's
# static website setup will need revisiting.

resource "azurerm_service_plan" "backend" {
  name                = "asp-${var.project_name}-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = var.location
  os_type             = "Linux"
  sku_name            = var.app_service_sku

  tags = var.tags
}

resource "azurerm_linux_web_app" "backend" {
  name                = "app-${var.project_name}-backend-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = azurerm_service_plan.backend.location
  service_plan_id     = azurerm_service_plan.backend.id

  # Key Vault references (@Microsoft.KeyVault(...) below) resolve using this
  # identity — granted access via the role assignment further down.
  identity {
    type = "SystemAssigned"
  }

  site_config {
    application_stack {
      python_version = "3.12"
    }
    app_command_line = "uvicorn app.main:app --host 0.0.0.0 --port 8000"

    # backend/app/main.py exposes an unauthenticated GET /health with no
    # downstream calls (just reflects in-memory settings) — confirmed
    # directly against the app repo before wiring this in. On a single B1
    # instance this mainly surfaces unhealthy status in the portal/App
    # Insights; it starts actually rotating instances out once this plan
    # scales beyond one.
    health_check_path                 = "/health"
    health_check_eviction_time_in_min = 2 # provider requires both set together; 2 = min allowed, fastest eviction

    # `dynamic` (with a static for_each) rather than a plain `cors {}` block —
    # the allowed_origins value below isn't known until the storage account
    # is created, and a plain block in that situation trips a known azurerm
    # provider bug ("Provider produced inconsistent final plan ... cors:
    # block count changed from 0 to 1"). The dynamic form sidesteps it since
    # Terraform evaluates for_each's cardinality independently of the
    # unknown content inside.
    dynamic "cors" {
      for_each = [1]
      content {
        allowed_origins = [
          trimsuffix(azurerm_storage_account.main.primary_web_endpoint, "/"), # static website endpoint (computed, not guessable)
          "http://localhost:8080",                                            # local dev, matches backend/.env.example default
        ]
      }
    }
  }

  app_settings = {
    # --- Non-secret config (plain values) ---
    AZURE_BLOB_CONTAINER_NAME              = var.blob_container_name
    AZURE_OPENAI_DEPLOYMENT_NAME           = var.openai_chat_deployment_name
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME = var.openai_embedding_deployment_name
    AZURE_OPENAI_API_VERSION               = var.openai_api_version
    AZURE_SEARCH_INDEX_NAME                = var.search_index_name
    USE_MOCK_AZURE                         = "false"
    DEBUG                                  = "false"
    # Lets Oryx build the Python app (pip install -r requirements.txt) on
    # the server during zip-deploy, instead of requiring a pre-built
    # package. The Azure DevOps app CI/CD pipeline (azure-pipelines.yml)
    # relies on this being set — previously force-set via CLI on every
    # deploy as a workaround; tracked here as code instead now.
    SCM_DO_BUILD_DURING_DEPLOYMENT = "true"
    FRONTEND_URL                   = trimsuffix(azurerm_storage_account.main.primary_web_endpoint, "/")
    CORS_ORIGINS                   = "[\"${trimsuffix(azurerm_storage_account.main.primary_web_endpoint, "/")}\",\"http://localhost:8080\"]"
    CHATBOT_ENABLED                = tostring(var.chatbot_enabled)
    CHATBOT_API_URL                = var.chatbot_api_url
    SMTP_HOST                      = "smtp.gmail.com"
    SMTP_PORT                      = "587"
    SMTP_FROM_NAME                 = "ResumeIQ Recruiting"

    # --- Secrets, resolved from the project Key Vault at runtime ---
    AZURE_STORAGE_CONNECTION_STRING      = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.storage_connection_string.versionless_id})"
    AZURE_DOCUMENT_INTELLIGENCE_KEY      = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.document_intelligence_key.versionless_id})"
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.document_intelligence_endpoint.versionless_id})"
    AZURE_OPENAI_API_KEY                 = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.openai_api_key.versionless_id})"
    AZURE_OPENAI_ENDPOINT                = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.openai_endpoint.versionless_id})"
    AZURE_OPENAI_EMBEDDING_API_KEY       = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.embedding_api_key.versionless_id})"
    AZURE_OPENAI_EMBEDDING_ENDPOINT      = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.embedding_endpoint.versionless_id})"
    AZURE_SEARCH_ADMIN_KEY               = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.search_api_key.versionless_id})"
    AZURE_SEARCH_ENDPOINT                = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.search_endpoint.versionless_id})"
    SMTP_USERNAME                        = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.smtp_username.versionless_id})"
    SMTP_PASSWORD                        = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.smtp_password.versionless_id})"
    GITHUB_TOKEN                         = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.github_token.versionless_id})"
    # Enables full Azure Monitor telemetry in backend/app/config.py (PR #8) —
    # produced by monitoring.tf, which previously didn't exist.
    APPLICATIONINSIGHTS_CONNECTION_STRING = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.app_insights_connection_string.versionless_id})"

    # HACKERRANK_API_KEY intentionally omitted — confirmed dead code, see
    # KNOWN-ISSUES.md #8.
  }

  tags = var.tags
}

# Grants the backend's managed identity read access to the secrets above.
# Scoped to this project's own vault only — never to Group5-6/AI_Keys.
resource "azurerm_role_assignment" "backend_secrets_user" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_web_app.backend.identity[0].principal_id
}
