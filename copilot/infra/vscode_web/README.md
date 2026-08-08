# Chat with Your Data — VS Code for the Web

This is a lightweight environment for deploying **Chat with Your Data** to your own Azure subscription directly from the browser. A terminal has opened with the solution already cloned via `azd init`.

Follow the steps below to get started.

## Deploy the solution

Provision the Azure infrastructure with:

```bash
azd up
```

You are prompted for an environment name, an Azure subscription, and a region. When it finishes, `azd` prints the application URL.

> **Important:** `azd up` provisions the infrastructure only. Before the application works, complete the post-deployment steps — build and push the container images and run the setup script — as described in [Step 5 of the Deployment Guide](https://github.com/Azure-Samples/chat-with-your-data-solution-accelerator/blob/main/docs/DeploymentGuide.md#step-5-post-deployment-configuration).

## Tear down

To delete the deployment and stop incurring charges, run:

```bash
azd down
```

## Continue on your desktop

You can keep working locally on VS Code Desktop by clicking **Continue On Desktop...** at the bottom-left of this screen. Take the `.env` file with you first:

- Right-click the `.env` file and select **Download**.
- Move the file from your Downloads folder into the cloned repository directory.
- On Windows, rename it back to `.env` (right-click > **Rename...**).
