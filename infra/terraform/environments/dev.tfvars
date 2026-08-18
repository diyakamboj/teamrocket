resource_group_name = "TeamRocket"
location            = "westus2"
project_name        = "resumeiq"
environment         = "dev"

# shared_keyvault_name / shared_keyvault_resource_group_name removed here —
# those variables no longer exist as of CHANGELOG.md entry (17): Group5-6
# values are now supplied directly via openai_api_key/openai_endpoint/
# embedding_api_key/search_api_key/search_endpoint (see secrets.auto.tfvars,
# gitignored, not this file), not read live via a data source.

openai_chat_deployment_name      = "gpt-5"
openai_embedding_deployment_name = "text-embedding-3-small"
search_index_name                = "candidates-index"
blob_container_name              = "resumes"

app_service_sku = "B1"

chatbot_enabled  = false
chatbot_api_url  = ""

tags = {
  project     = "resumeiq"
  team        = "teamrocket"
  environment = "dev"
}

# smtp_username, smtp_password, github_token intentionally NOT set here —
# supply via a gitignored secrets.auto.tfvars or CI secret injection.
