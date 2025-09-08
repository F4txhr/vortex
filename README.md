# Vortex Proxy Worker

This is a dynamic proxy worker for Cloudflare, refactored and with a new testing suite.

## Development

### Running Tests

To run the automated tests for this project, first ensure you have merged the pull request containing the test setup and pulled the changes to your local machine.

Then, follow these steps:

1.  **Install Dependencies:**
    Make sure you have Node.js and npm installed. Open your terminal in the project's root directory and run the following command. This will install `vitest` and other necessary development packages.
    ```bash
    npm install
    ```

2.  **Run Tests:**
    Once the dependencies are installed, you can run the entire test suite with this command:
    ```bash
    npm test
    ```
    This will execute all `*.test.js` files and show you the results in the terminal.

### Running on Termux

Yes, it is possible to run the test suite on Android using Termux.

First, you need to install the necessary packages within Termux:
```bash
pkg update && pkg upgrade
pkg install nodejs git
```

After that, you can clone your repository and follow the standard testing steps above (`npm install`, `npm test`).
