# SecurePaste // Zero-Knowledge Communication Platform

![Security](https://img.shields.io/badge/Security-Air--Gapped-green) ![Encryption](https://img.shields.io/badge/Encryption-AES--GCM--256-blue) ![Stack](https://img.shields.io/badge/Backend-FastAPI-teal)

**SecurePaste** is a secure, ephemeral communication platform designed for **Zero-Knowledge** text sharing and real-time encrypted chat within local networks.

Unlike traditional pastebins, the server is architected as a **Blind Relay**. It stores ciphertext but never receives the decryption key. Keys are generated client-side and passed via the URL fragment (`#`), ensuring they never touch the network stack.

## 🏗️ Architecture

![System Architecture](1uml.png)
*(Client-side encryption flow ensuring the server remains blind to the payload)*

## 🛡️ Key Features

* **Zero-Knowledge Encryption:** AES-GCM-256 encryption happens entirely in the browser (WebCrypto API).
* **Local-First Security:** Designed for Intranet/LAN deployment to prevent data leak to the public internet.
* **Ephemeral Lifecycle:**
    * **Auto-Janitor:** Database automatically purges records older than 1 hour.
    * **Burn-After-Reading:** Optional self-destruct mode for single-view messages.
* **Secure Chat Protocol:** Real-time, anonymous messaging via WebSockets with end-to-end encryption.
* **Session Security:** Admin authentication uses in-memory ephemeral tokens. Switching tabs or closing the browser instantly kills the session to prevent shoulder-surfing.

## 🚀 Quick Start

1.  **Clone the repository**
    ```bash
    git clone [https://github.com/S3cr3tpt/SecurePaste.git](https://github.com/S3cr3tpt/SecurePaste.git)
    cd SecurePaste
    ```

2.  **Install Dependencies**
    ```bash
    pip install -r requirements.txt
    ```

3.  **Launch Server (LAN Mode)**
    ```bash
    python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
    ```

4.  **Access**
    * **Local:** `http://127.0.0.1:8000`
    * **Network:** `http://<YOUR_LAN_IP>:8000`

## ⚠️ Disclaimer
This project is a Proof of Concept (PoC) for a Software Engineering architecture course. It demonstrates "Privacy by Design" principles using standard cryptographic primitives.

---
*Developed by Joao Filipe Correia Andrade Sousa*