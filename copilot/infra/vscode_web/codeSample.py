"""Minimal Azure AI Foundry project client sample for Chat with Your Data.

After `azd up` provisions the solution, the deployed Azure AI Foundry project
endpoint becomes available. This snippet connects to it with your Azure
credentials so you can start building on top of the project from code. Set
AZURE_EXISTING_AIPROJECT_ENDPOINT in the .env file to the project endpoint
printed by the deployment before running it.
"""

import os

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

endpoint = os.environ["AZURE_EXISTING_AIPROJECT_ENDPOINT"]

project = AIProjectClient(
    credential=DefaultAzureCredential(),
    endpoint=endpoint,
)

# List the agents defined on the project as a connectivity check.
for agent in project.agents.list_agents():
    print(f"{agent.id}: {agent.name}")
