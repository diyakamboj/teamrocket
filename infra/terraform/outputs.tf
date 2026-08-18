# Nothing sensitive here by design — secret values live only in Key Vault,
# never in state-adjacent output that might get pasted into a PR comment or
# CI log.

output "resource_group_name" {
  value = data.azurerm_resource_group.main.name
}

output "storage_account_name" {
  value = azurerm_storage_account.main.name
}

output "frontend_static_website_url" {
  description = "Deploy the frontend build's contents to the $web container of this storage account."
  value       = trimsuffix(azurerm_storage_account.main.primary_web_endpoint, "/")
}

output "backend_url" {
  value = "https://${azurerm_linux_web_app.backend.default_hostname}"
}

output "key_vault_name" {
  value = azurerm_key_vault.main.name
}

output "key_vault_uri" {
  value = azurerm_key_vault.main.vault_uri
}

output "document_intelligence_endpoint" {
  value = azurerm_cognitive_account.document_intelligence.endpoint
}
