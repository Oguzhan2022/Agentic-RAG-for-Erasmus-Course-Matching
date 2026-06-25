# 🎓 Agentic RAG for Erasmus Course Matching

An AI-driven, coordinator-approved course matching and grade transfer automation platform custom-built for **İstanbul Kültür Üniversitesi (İKÜ)** Erasmus+ students and administration. This application streamlines the academic approval process by parsing course syllabi, calculating compatibility scores, and automating the grade conversion workflow.

---

## Architecture & Technology Stack

The application is built on a modern, decoupled architecture:

* **Frontend:** React 19 (TypeScript, Vite, Ant Design, TanStack Query, React Router Dom, i18next).
* **Backend:** FastAPI (Python 3.10+), SQLAlchemy ORM.
* **Database:** PostgreSQL (with `pgvector` extension for vector similarity search).
* **Task Queue:** Celery with Redis broker (for asynchronous background syllabus processing and match jobs).
* **AI/LLM Engine:** Google Gemini API (specifically utilizing the **Gemma 4 31B** instruction-tuned model, `gemma-4-31b-it`) orchestrated via **LangChain**, alongside local `sentence-transformers/all-MiniLM-L6-v2` for generating 384-dimensional course embeddings.

---

## Core Modules & Functionality

### 1. Catalog Ingestion & Syllabus Parsing (`ingestion`, `parsing`)
* **University Onboarding:** Supports onboarding of new universities, departments, and course catalogs.
* **Asynchronous Processing:** Asynchronously uploads and processes PDF syllabus documents using Celery tasks and Redis brokers.
* **LLM Syllabus Parser:** Extracts structured information (course code, name, ECTS credits, detailed content description, and specific learning outcomes) from unstructured syllabus PDFs using the Gemini API.

### 2. Retrieval-Augmented Generation (RAG) & Match Engine (`retrieval`, `matching`)
* **Vector Retriever:** Generates 384-dimensional dense vector representations of courses using local `sentence-transformers/all-MiniLM-L6-v2` embeddings, stored in a PostgreSQL `pgvector` database index.
* **Cosine Similarity Retrieval:** Computes cosine similarity of course vectors to fetch the top equivalent courses.
* **Hybrid Fusion Scorer:** A multi-layered score calculation combining:
  * *Deterministic Metrics:* Checks academic level (BSc/MSc), semester matching, title token overlaps, ECTS differences, and department metadata alignment.
  * *Semantic LLM Analysis:* Reviews similarities in topics, course structure, and learning goals using the **Gemma 4 31B** instruction-tuned model.
  * *Academic Profiles:* Supports Technical, Social, and Studio-based course categories with customized weighting profiles.
* **Comparative Batch Match:** Sends the top candidate matches in a single comparative context to the LLM to cross-evaluate them and assign contextually balanced scores.

### 3. Agentic Verification Loop (`verification`)
* **Batch Verification Agent:** Runs an independent LLM-powered verification agent (`BatchVerifier`) to audit matches.
* **Risk Auditing & Validation:** Compiles content overlap assessments, flags structural risks (e.g., credit deficits, missing prerequisite topics), and assigns recommendation statuses (`approved`, `partial`, `risk_flagged`) with explicit textual explanations and confidence metrics.

### 4. Student Application & Transcript Parsing (`backend/routers/transcripts.py`)
* **Automated PDF Parsing:** Extracts course names, codes, credits, and grades from uploaded student transcripts of records (including OCR fallbacks).
* **Credit Recognition Generation:** Automatically compiles and exports official Learning Agreements and Course Recognition (Ders Transfer) forms in PDF and Excel formats.

### 5. Transfer Document Verification & Audit Loop (`backend/routers/transfer_documents.py`)
* **10-Column Course Recognition Audits:** Parses official Ders Transfer Formu uploads to verify partner course names, credits, local grades, ECTS grades, and local equivalent grades.
* **Grading Rule Compliance:** Cross-references the transcript grades against active university grading scheme snapshots to flag any discrepancy (Valid, Invalid, Partial, or Manual Check Required).
* **LLM-Powered Error Explanations:** Runs the Gemini LLM to automatically generate human-readable explanations detailing *why* any grade conversion or ECTS mismatch occurred to assist Registrar (Ogrenci Isleri) audits.
* **Active Versioning & Re-uploads:** Supports document revision tracking, letting users re-upload corrected documents and switch active validation versions seamlessly.

### 6. Grading Schemes & Conversions (`backend/routers/grading_schemes.py`)
* **Grade Schemes Management:** Allows university administrators to configure university-to-university grade maps.
* **Auto-Conversion:** Automates the conversion of letters/numbers into local university scales (IKU) based on approved grading schemas.

### 7. Senate Decisions & Regulatory Compliance (`backend/routers/senate_decisions.py`)
* **Senate Records Registry:** Logs official board decision numbers, approval dates, and associated PDF attachments for matched courses.
* **Compliance Archiving:** Stores matching records in compliance with academic regulations.

### 8. Security & Role-Based Access Control (`authorization`)
* **JWT-Based Authentication:** Uses secure tokens with JSON Web Token (JWT) algorithms.
* **Fine-Grained Permissions:** Enforces role restrictions at route middleware levels for:
  * **Student:** Submits applications and views match progress.
  * **Department Admin / Coordinator:** Configures catalogs, reviews and approves match suggests.
  * **Faculty Admin:** Registers senate decisions.
  * **Registrar (Ogrenci Isleri):** Verifies final transcripts and executes grade transfers.
  * **System Admin:** Exercises full database and system parameters authority.

---

## Prerequisites

Ensure you have the following installed on your system:

1. **Docker Desktop** (Required for PostgreSQL and Redis)
2. **Python 3.10+** (Required for the Backend API)
3. **Node.js (LTS)** (Required for the Frontend React App)

---

## Environment Configuration

Create a `.env` file in the project root directory with the following variables:

```env
GEMINI_API_KEY=your_google_gemini_api_key_here
DATABASE_URL=postgresql://erasmus:erasmus_dev@localhost:5600/erasmus_match
JWT_SECRET=your_jwt_secret_key_here
ADMIN_PASSWORD=your_desired_admin_password_here
USE_CELERY=true
VITE_API_URL=/api
```

---

## Getting Started

### First-Time Installation and Run

1. Make sure **Docker Desktop** is open and running.
2. Double-click the **`setup_and_run.bat`** script in the project root.
3. This batch script automatically:
   * Verifies Docker, Python, and Node.js dependencies.
   * Creates a Python virtual environment (`.venv`) and installs `requirements.txt`.
   * Installs frontend packages via `npm install`.
   * Spins up the PostgreSQL and Redis containers via Docker Compose.
   * Prompts you to restore the database from a local backup (`local_backup_*.sql`) or start with an empty database.
   * Starts the FastAPI backend, Celery worker, and Vite dev server.

### Subsequent Launches

1. Ensure **Docker Desktop** is running.
2. Double-click **`start.bat`** to run the services.
3. Open your browser and navigate to **`http://localhost:3000`** to access the application.

---

## Default Addresses & Ports

| Service | URL / Port |
| :--- | :--- |
| **Frontend Web App** | http://localhost:3000 |
| **Backend API Docs (Swagger)** | http://localhost:8000/docs |
| **PostgreSQL Database** | `localhost:5600` (User: `erasmus`, DB: `erasmus_match`) |
| **Redis Broker** | `localhost:6379` |

Oğuzhan Yasin Ceyhan
Bartu Başar
Emincan Ünerden
