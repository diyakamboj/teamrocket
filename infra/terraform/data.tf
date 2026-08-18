# -----------------------------------------------------------------------------
# Existing resource group. TeamRocket already exists and is owned; this
# config provisions into it rather than creating a new one.
# -----------------------------------------------------------------------------

data "azurerm_resource_group" "main" {
  name = var.resource_group_name
}

# -----------------------------------------------------------------------------
# Shared AI credentials (Group5-6 vault, AI_Keys resource group) — REMOVED as
# live data sources 2026-08-18. Previously read here on every plan/apply,
# which meant *any* identity running Terraform needed data-plane read access
# to Group5-6 — including the GitHub Actions SP, which never got that access
# (KNOWN-ISSUES.md #4/#13's pending spandana@quadranttechnologies.com grant).
# Since Terraform re-evaluates data sources on every single run (not just
# once at creation), this blocked the SP from running *any* plan/apply, not
# just the first one.
#
# Replaced with plain variables (see variables.tf: openai_api_key,
# openai_endpoint, embedding_api_key, embedding_endpoint, search_api_key,
# search_endpoint) — same pattern already used for smtp_username/
# github_token. Trade-off: values are now a static copy, not a live read —
# if Group5-6's values ever rotate, someone needs to manually re-supply the
# new value (there's no more automatic pickup). In exchange, the SP needs
# zero access to Group5-6 to run Terraform at all.
#
# The interactive user still has Key Vault Secrets Officer on Group5-6
# (KNOWN-ISSUES.md #4) and can read current values there directly
# (`az keyvault secret show --vault-name Group5-6 --name <name>`) to supply
# for the initial apply.
# -----------------------------------------------------------------------------
