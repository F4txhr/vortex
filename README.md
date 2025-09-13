# Proxy Health Checker & Subscription Generator (for Deno Deploy)

This Cloudflare Worker has been refactored and ported to **Deno Deploy** to overcome platform limitations encountered on the Cloudflare Workers free plan.

## Why Deno Deploy?

The original goal of checking the health of raw TCP proxies requires the `sockets` API. Our experiments proved that this API is not available on your Cloudflare plan, making the health check feature impossible to implement there.

Deno Deploy is a modern serverless platform that **does not have this limitation**. It is also free and does not require a payment method for its basic tier. This makes it the ideal platform to host this application.

## How to Deploy (on Android)

You can deploy this entire application for free using just your phone.

1.  **Go to Deno Deploy:** Open a web browser and navigate to [dash.deno.com](https://dash.deno.com).
2.  **Login with GitHub:** Create an account or log in using your GitHub account.
3.  **Create a New Project:** Find the "New Project" button.
4.  **Select a Playground:** Choose to create a "Playground" project. This will give you a simple in-browser code editor.
5.  **Paste the Code:** You will see a default "Hello World" code. **Delete all of it.** Then, copy the entire content of the `main.js` file from this repository and paste it into the editor.
6.  **Set Environment Variables:** This is a crucial step. Find the "Settings" for your new project, then go to the "Environment Variables" section. You need to add the following variables:
    *   `PROXY_LIST_URL`: The full URL to your `proxyList.txt` file.
    *   `VMESS_UUID`: Your personal V2Ray UUID.
    *   `VMESS_WEBSOCKET_HOST`: The websocket host for your V2Ray setup.
    *   `VMESS_WEBSOCKET_PATH`: The websocket path for your V2Ray setup (e.g., `/your-path`).
7.  **Save and Deploy:** Click the "Save and Deploy" button. Your API will now be live at the URL provided by Deno Deploy.

## API Endpoints

Once deployed, your API will have the following endpoints:

*   `POST /force-health`: Starts the background process to check all proxies.
*   `GET /health`: Shows a JSON summary of the health check results.
*   `GET /sub/v2ray`: Generates the Base64-encoded V2Ray subscription link from the healthy proxies.
*   `GET /`: Shows a basic status message and a warning if your V2Ray environment variables are not set.
