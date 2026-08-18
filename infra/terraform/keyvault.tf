# Project-owned Key Vault. Distinct from the shared Group5-6 vault — this one
# is fully managed by this Terraform config, so App Service's managed
# identity only ever needs access to resources this project controls, never
# to AI_Keys (which this identity doesn't have ARM rights on anyway).
resource "random_string" "keyvault_suffix" {
  length  = 4
  special = false
  upper   = false
}

resource "azurerm_key_vault" "main" {
  name                = "kv-${var.project_name}-${var.environment}-${random_string.keyvault_suffix.result}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = var.location
  tenant_id           = data.azurerm_client_config.current.tenant_id

  sku_name                   = "standard"
  rbac_authorization_enabled = true
  purge_protection_enabled   = false # dev-tier; enable before this holds anything prod cares about

  tags = var.tags
}

# Fixed principal (var.terraform_operator_principal_id), NOT
# data.azurerm_client_config.current.object_id ("whoever's running this
# right now"). A dynamic principal seemed convenient early on (the human
# was the only one ever applying), but breaks the moment a second identity
# (the GitHub Actions SP) also runs plan/apply: Terraform sees the
# principal "changed" and wants to replace this resource, which only an
# identity already holding roleAssignments/write can execute — the SP
# can't, since this IS how it would get that kind of access in the first
# place (chicken-and-egg). Fixed principal = stable no-op regardless of
# caller, once applied once. Defaults to the GitHub Actions SP's object
# id, since it's the intended routine operator; the human retains their
# own standing User Access Administrator and can self-grant separately
# for one-off manual applies if ever needed.
resource "azurerm_role_assignment" "terraform_secrets_officer" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = var.terraform_operator_principal_id
}

# -----------------------------------------------------------------------------
# Secrets copied from the shared Group5-6 vault. Values live in this vault so
# App Service only ever depends on a resource this project owns.
# -----------------------------------------------------------------------------

resource "azurerm_key_vault_secret" "openai_api_key" {
  name         = "AZURE-OPENAI-API-KEY"
  value        = var.openai_api_key
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_role_assignment.terraform_secrets_officer]
}

resource "azurerm_key_vault_secret" "openai_endpoint" {
  name         = "AZURE-OPENAI-ENDPOINT"
  value        = var.openai_endpoint
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_role_assignment.terraform_secrets_officer]
}

resource "azurerm_key_vault_secret" "search_api_key" {
  name         = "AZURE-SEARCH-ADMIN-KEY"
  value        = var.search_api_key
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_role_assignment.terraform_secrets_officer]
}

resource "azurerm_key_vault_secret" "search_endpoint" {
  name         = "AZURE-SEARCH-ENDPOINT"
  value        = var.search_endpoint
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_role_assignment.terraform_secrets_officer]
}

# Note: the embedding key points at the same sharedfoundry host as
# openai_api_key/openai_endpoint above — kept as a separate secret here in
# case it ever diverges, but today AZURE_OPENAI_API_KEY doubles as the
# embedding call's credential too. (No separate embedding endpoint secret —
# see variables.tf's comment on the dropped embedding_endpoint variable.)
resource "azurerm_key_vault_secret" "embedding_api_key" {
  name         = "AZURE-OPENAI-EMBEDDING-API-KEY"
  value        = var.embedding_api_key
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_role_assignment.terraform_secrets_officer]
}

# -----------------------------------------------------------------------------
# Secrets for net-new resources this config creates.
# -----------------------------------------------------------------------------

resource "azurerm_key_vault_secret" "storage_connection_string" {
  name         = "AZURE-STORAGE-CONNECTION-STRING"
  value        = azurerm_storage_account.main.primary_connection_string
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_role_assignment.terraform_secrets_officer]
}

resource "azurerm_key_vault_secret" "document_intelligence_key" {
  name         = "AZURE-DOCUMENT-INTELLIGENCE-KEY"
  value        = azurerm_cognitive_account.document_intelligence.primary_access_key
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_role_assignment.terraform_secrets_officer]
}

resource "azurerm_key_vault_secret" "document_intelligence_endpoint" {
  name         = "AZURE-DOCUMENT-INTELLIGENCE-ENDPOINT"
  value        = azurerm_cognitive_account.document_intelligence.endpoint
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_role_assignment.terraform_secrets_officer]
}

# -----------------------------------------------------------------------------
# Placeholder secrets — not yet available (KNOWN-ISSUES.md #8). Written as
# empty strings so App Service's Key Vault references resolve to *something*
# rather than failing outright; update via `terraform apply` once real values
# exist (e.g. `terraform apply -var="github_token=ghp_..."`, or a gitignored
# *.auto.tfvars file — never commit real values).
# -----------------------------------------------------------------------------

resource "azurerm_key_vault_secret" "smtp_username" {
  name         = "SMTP-USERNAME"
  value        = var.smtp_username
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_role_assignment.terraform_secrets_officer]
}

resource "azurerm_key_vault_secret" "smtp_password" {
  name         = "SMTP-PASSWORD"
  value        = var.smtp_password
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_role_assignment.terraform_secrets_officer]
}

resource "azurerm_key_vault_secret" "github_token" {
  name         = "GITHUB-TOKEN"
  value        = var.github_token
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_role_assignment.terraform_secrets_officer]
}
