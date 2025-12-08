Since you are on **Amazon Linux** and want the **production** setup (built frontend files instead of development mode), here is the exact sequence of commands.

This guide assumes you are already logged into your EC2 terminal.

### Step 1: Install System Updates & Tools
Amazon Linux requires `yum` or `dnf` to install packages. We will install Git, Python, Node.js, and Screen (to keep servers running).

Run this block:
```bash
# Update system
sudo yum update -y

# Install Git, Python3, Pip, and Screen
sudo yum install git python3-pip screen -y

# Install Node.js (Amazon Linux specific setup for latest Node)
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install nodejs -y

# Verify installations
node -v
python3 --version
```

### Step 2: Clone Your Repository

```bash
cd ~
git clone https://github.com/Adikumaw/trend-reversal-automation-bot.git

# Enter the repository folder (Change 'repo_name' to your actual folder name)
cd trend-reversal-automation-bot
```

---

### Step 3: Setup & Run Backend (Port 8000)
We will use a virtual environment and run the server using `screen` so it stays alive when you disconnect.

1.  **Navigate to your python folder:**
    ```bash
    cd python
    ```

2.  **Install Dependencies:**
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    pip install fastapi uvicorn
    # If you have a requirements.txt, run: pip install -r requirements.txt
    ```

3.  **Start the Backend in Background:**
    ```bash
    # Create a screen session named "backend"
    screen -S backend
    
    # Run the server (Port 8000 is defined in your main.py)
    python3 main.py
    ```
    *(You should see "Uvicorn running on http://0.0.0.0:8000")*

4.  **Detach:** Press **`CTRL + A`**, then **`D`**.
    *(The backend is now running safely in the background).*

---

### Step 4: Setup & Run Frontend (Port 3000)
For production, we will **build** the optimized files and serve them using a lightweight static server.

1.  **Navigate to your frontend folder:**
    ```bash
    cd ..
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Verify API URL (Crucial):**
    Since you cloned the repo, ensure `api.ts` has your **Elastic IP**.
    ```bash
    # Check the file content
    cat src/api.ts
    ```
    *If it doesn't show `75.101.175.60`, edit it now:*
    ```bash
    nano src/api.ts
    # Change URL to "http://75.101.175.60:8000", Save (Ctrl+O, Enter), Exit (Ctrl+X)
    ```

4.  **Build for Production:**
    This compiles your TypeScript into optimized HTML/CSS/JS.
    ```bash
    npm run build
    ```
    *(This creates a `dist` folder).*

5.  **Serve the Build:**
    We will use `serve` (a simple static file server) to host the `dist` folder on port 3000.

    ```bash
    # Install 'serve' globally
    sudo npm install -g serve
    
    # Create screen session for frontend
    screen -S frontend
    
    # Serve the 'dist' folder on Port 3000
    serve -s dist -l 3000
    ```

6.  **Detach:** Press **`CTRL + A`**, then **`D`**.

---

### Step 5: Access Your System
Everything is now running.

1.  Open your browser.
2.  Go to: **`http://75.101.175.60:3000`**

### Summary of Commands to Manage the App
*   **To check Backend logs:** `screen -r backend`
*   **To check Frontend logs:** `screen -r frontend`
*   **To detach from screen:** `CTRL+A`, `D`
*   **To kill a screen:** Inside the screen, press `CTRL+C`, then type `exit`.