# Provider + Terraform version constraints.
#
# Remote state: bootstrapped 2026-08-18 inside TeamRocket (storage account
# stresumeiqtfstate, container tfstate) — colocated there only because this
# identity's access (Contributor + User Access Administrator via the
# TeamRocket group) doesn't extend to creating a separate resource group;
# see KNOWN-ISSUES.md #10/#11 for the full reasoning. That means this state
# currently shares a blast radius with the infrastructure it describes.
#
# THIS MAY NEED TO MOVE LATER: if subscription-level access becomes
# available (or someone else creates a dedicated rg-resumeiq-tfstate and
# grants access to it), migrate with:
#   terraform init -backend-config="resource_group_name=<new-rg>" \
#     -backend-config="storage_account_name=<new-account>" \
#     -backend-config="container_name=tfstate" \
#     -backend-config="key=resumeiq-dev.tfstate" \
#     -backend-config="use_azuread_auth=true" \
#     -migrate-state
# This is a normal, low-risk operation as long as no one else is applying
# concurrently — verify with `terraform plan` afterward (expect "no
# changes"). Also noted in DOCUMENTATION.md and KNOWN-ISSUES.md #10.

terraform {
  required_version = ">= 1.9"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "azurerm" {
    resource_group_name  = "TeamRocket"
    storage_account_name = "stresumeiqtfstate"
    container_name       = "tfstate"
    key                  = "resumeiq-dev.tfstate"
    use_azuread_auth     = true # RBAC (Storage Blob Data Contributor), not storage account keys
  }
}

provider "azurerm" {
  features {
    key_vault {
      # Dev convenience: allow a destroyed vault's name to be reused instead
      # of sitting in soft-delete purgatory for 90 days.
      purge_soft_delete_on_destroy    = true
      recover_soft_deleted_key_vaults = true
    }
  }
}

# Identity Terraform itself is running as — used to grant this identity
# (currently the interactive user; later a GitHub Actions OIDC service
# principal) management rights on resources this config creates.
data "azurerm_client_config" "current" {}
