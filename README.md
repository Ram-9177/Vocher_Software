# St. Mary’s Voucher System

A secure, client-side web application designed to manage, track, and print financial vouchers for **St. Mary's Group of Institutions Guntur For Women** and **St. Mary's Women's Engineering College (Budampadu)**.

---

## 📂 Repository Architecture

The codebase has been refactored from a single monolithic file into a modular, modern web structure:

```bash
StMarysGuntur/
├── index.html       # Cleaned HTML markup structure
├── style.css        # Theme CSS, animations, responsive layouts, print styles
├── app.js           # Core JS application logic and browser API integrations
├── assets/          # Project images and logos
│   ├── logo_smg.png     # St. Mary's Group Logo
│   └── logo_smwec.jpg   # St. Mary's Women's Engineering College Logo
└── .gitignore       # Git exclusion configuration
```

### 1. `index.html`
Defines the document structure. It acts as the skeleton of the system:
- **College Picker screen (`#CP`)**: Allows users to select their target campus on startup.
- **Sign In / Sign Up panels (`#LS`)**: Authentication interface with tab switching.
- **Main App Dashboard (`#APP`)**: Contains navigation sidebar, stats grids, voucher forms, datatables, and printing templates.

### 2. `style.css`
Houses the design system, themed variables, and typography (using Google Fonts: EB Garamond & Inter). It contains styles for:
- App layouts, cards, buttons, status badges, and slide-in toast notifications.
- Precise layout rules for printing (A4 and A5 sizes) so that printed vouchers match physical dimensions.

### 3. `app.js`
Handles all client-side state and browser APIs:
- **State variables**: Holds current list of vouchers (`VS`), currently logged-in user (`CU`), active college context (`CURRENT_COLLEGE`), etc.
- **Excel linking**: Links and auto-saves records to a local Excel file using the modern **File System Access API** (with persistent handle storage via IndexedDB).
- **USB Serial Printing**: Connects to thermal ESC/POS receipt printers using the **Web Serial API**.
- **Auth & sync logic**: Uses secure SHA-256 password hashing for accounts (admin1, admin2, admin3) and communicates with cloud sync endpoints.

---

## 🚀 Key Features & Functionality

### 1. Multi-Institution College Picker
Users pick their campus on startup. `admin1` (the primary administrator) has crossover privileges and can switch contexts dynamically via the top-bar college pill to view or edit the other institution's records.

### 2. Role-Based Authentication
Provides three levels of administrative access:
- **`admin1`**: Full administrator. Has access to all dashboards, analytics, password resets for sub-accounts, and crossover privileges.
- **`admin2` / `admin3`**: Limited administrators. Can only create, view, and print their own vouchers.

### 3. Excel Integration (Auto-Save & Linking)
Users can click the **Link Excel** pill in the sidebar. This uses the browser's File System Access API to:
1. Prompt the user to select or create a local `.xlsx` file.
2. Store the file handle in **IndexedDB** so the connection is automatically restored when the page is refreshed.
3. Automatically update, format, and save all modifications to the linked Excel workbook immediately when any voucher is saved.

### 4. Thermal Printer Support
Integrates with thermal receipt printers directly from the browser using the Web Serial API (ESC/POS). Administrators can connect, disconnect, and test the printer, generating physical receipts instantly.

---

## 🛠️ Getting Started & Local Development

This is a client-side frontend application. You can run it locally in any modern browser (Chrome or Edge recommended for File System Access and Web Serial APIs).

### Method A: Open Directly
Double-click `index.html` on your computer to open the application in your browser.

### Method B: Live Server (Recommended)
Use a local development server to serve the directory:
- **VS Code**: Install the "Live Server" extension and click **Go Live**.
- **Python**: Run `python3 -m http.server 8080` in the directory, and navigate to `http://localhost:8080`.
