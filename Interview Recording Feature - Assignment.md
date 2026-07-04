**Interview Recording Feature \- Take Home Assignment**  
Build a native iOS application that allows users to record interview sessions. The system should reliably capture high-quality audio, manage local storage, and synchronize recorded data with a backend service. The goal is to create a robust, user-friendly recording tool that handles network interruptions gracefully.**Core Requirements iOS Application Requirements**

1. **Recording Interface**  
   * Intuitive UI to start, pause, and stop recordings.  
   * Visual indicators (e.g., waveform, timer) during active recording.  
   * Ability to add metadata for each session (e.g., interviewee name, tags).  
2. **Data Management**  
   * Local storage for recordings before and after upload.  
   * A list view to manage past recordings (view details, delete, re-upload if failed).  
3. **Synchronization**  
   * Background upload functionality.  
   * Automatic retry logic for failed network requests.  
   * Status tracking (e.g., "Uploading", "Synced", "Failed").

**Backend Requirements**

1. **API Endpoints**  
   * REST API to receive audio file uploads and metadata.  
   * Endpoints to fetch a list of user recordings and individual recording details.  
2. **Storage**  
   * Database to store metadata and file references.  
   * Cloud storage (e.g., AWS S3 or similar) for the audio files.

**Technical Specifications**

* **Mobile App**: Swift/SwiftUI (native) or React Native.  
* **Backend**: Node.js, Python, or Go.  
* **Database**: PostgreSQL, MongoDB, or your preferred SQL/NoSQL database.  
* **Networking**: Choice of any library/framework (e.g., URLSession, Alamofire, Axios, Fetch API).

**Additional Expectations**

* **Security**: Briefly address how you would handle user authentication or secure API requests.

**Bonus**

* **API Documentation**: Basic documentation for your API endpoints (e.g., a simple README or Swagger/OpenAPI).  
* **Unit Testing**: Coverage for core logic (e.g., recording management, synchronization). Note: These are not requirements, but are appreciated as a bonus if delivered.

**Deliverables**

1. **iOS Codebase**: Source code for the iOS app.  
2. **Backend Codebase**: API server code and database schema.  
3. **README.md**:  
   * Setup instructions.  
   * Explanation of architecture and key design decisions (e.g., local storage strategy).  
   * Known limitations and potential improvements.

**Time Expectation**

* **Maximum Time**: 2 days.  
* **Prioritization**: Focus on stable recording and reliable upload/sync mechanisms first.

---

