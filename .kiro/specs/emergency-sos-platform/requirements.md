# Requirements Document

## Introduction

This document defines the requirements for an offline-first Progressive Web Application (PWA) emergency response platform. The platform connects survivors in distress with appropriate responders through intelligent geo-aware dispatch. It consists of three interfaces — Survivor PWA, Responder PWA, and Command Center — all communicating with a shared backend. The system captures a survivor's location, creates and preserves emergency requests offline, routes incidents by geography and emergency type, identifies suitable available responders, manages dispatch and escalation, tracks the complete rescue lifecycle, and provides authorities with a real-time command center.

The PWA does NOT claim phone-to-phone mesh, BLE relay, or offline transmission capabilities. Those are future native communication layers that will plug into the same architecture through the ConnectivityManager abstraction.

## Glossary

- **Survivor_PWA**: The progressive web application interface used by civilians to create and track emergency SOS requests
- **Responder_PWA**: The progressive web application interface used by authorized field personnel (police, medical, rescue teams) to receive and manage assigned incidents
- **Command_Center**: The web application interface used by dispatchers, supervisors, and administrators to monitor, manage, and dispatch emergency incidents
- **Backend**: The server-side application (Node.js + Express + PostgreSQL) that processes SOS requests, manages dispatch, and serves all three interfaces
- **SOS**: An emergency request created by a survivor, containing location, emergency type, and optional additional information
- **Geo_Dispatch_Engine**: The backend subsystem that determines the appropriate region, emergency type routing, and optimal responder for an SOS incident
- **Priority_Engine**: The backend subsystem that calculates a priority score for each SOS based on configurable factors and assigns a priority band
- **ConnectivityManager**: A frontend abstraction layer that manages communication between the PWA and the backend, designed to allow future native mesh providers without rewriting the application
- **Sync_Engine**: The frontend subsystem responsible for queuing SOS requests locally and delivering them to the backend when connectivity is available
- **Service_Worker**: The browser-level worker that caches the application shell for offline access and manages background sync where supported
- **Responder**: An authorized person (police officer, medical personnel, rescue team member) registered in the system to respond to incidents
- **Dispatcher**: An authorized operator in the Command Center who manages incidents and assigns responders
- **Region**: A geographic area with defined boundaries containing associated stations, responders, and dispatch rules
- **Station**: A fixed facility (police station, hospital, relief center) associated with a region
- **Incident_Lifecycle**: The ordered sequence of states an SOS passes through: Created → Saved → Queued → Sending → Delivered → Acknowledged → Dispatched → En Route → Arrived → Resolved
- **Location_Freshness**: The elapsed time since a responder's location was last updated, used to assess reliability of position data
- **Priority_Band**: A classification (Critical, High, Medium, Low) derived from the priority score
- **Disaster_Event**: An administrator-created entity representing a large-scale emergency (flood, earthquake) with which individual SOS incidents can be associated
- **IndexedDB**: The browser-provided local database used (via Dexie wrapper) to persist SOS data on the survivor's device
- **Background_Sync**: A browser API that allows the Service Worker to defer SOS delivery until connectivity returns
- **PWA**: Progressive Web Application — a web application that can be installed on a device and function offline

---

## Requirements

### Requirement 1: One-Tap SOS Creation

**User Story:** As a survivor, I want to create an emergency request with a single tap, so that I can get help without needing to learn the application or fill in forms.

#### Acceptance Criteria

1. THE Survivor_PWA SHALL present four emergency type buttons on the home screen: Police/Rescue, Food/Water, Medical Help, and Children/Elderly, each with a minimum touch target size of 48x48 CSS pixels
2. WHEN a survivor taps an emergency type button, THE Survivor_PWA SHALL generate a UUID-based SOS identifier, capture the current GPS coordinates (latitude, longitude, and accuracy), record the current timestamp, and create an SOS record within 2 seconds of the tap
3. IF the device cannot acquire a current GPS position within 5 seconds of the tap, THEN THE Survivor_PWA SHALL use the last known location, include an accuracy warning visible to the survivor, and still create the SOS record
4. WHEN a survivor taps an emergency type button, THE Survivor_PWA SHALL save the SOS record to IndexedDB before attempting any network communication
5. IF the SOS record cannot be saved to IndexedDB, THEN THE Survivor_PWA SHALL display an error message indicating the SOS could not be stored and SHALL NOT indicate that help is on the way
6. WHEN a survivor taps an emergency type button, THE Survivor_PWA SHALL display confirmation showing the SOS identifier and the emergency type selected, and SHALL indicate the delivery status as one of: "Saved locally", "Sending", or "Delivered to emergency network"
7. IF the same survivor taps an emergency type button more than once within 30 seconds, THEN THE Survivor_PWA SHALL prompt the survivor to confirm whether they intend to create an additional SOS rather than silently creating a duplicate record

---

### Requirement 2: GPS Location Capture

**User Story:** As a survivor, I want my location to be automatically captured when I create an SOS, so that responders know where to find me without requiring me to describe my location.

#### Acceptance Criteria

1. WHEN an SOS is created, THE Survivor_PWA SHALL request the device GPS and capture latitude, longitude, accuracy (in meters), and timestamp, waiting no longer than 10 seconds before treating the acquisition as failed
2. IF the current GPS location cannot be acquired within the timeout, THEN THE Survivor_PWA SHALL fall back to the last known location provided it is no older than 30 minutes, and display a warning indicating the location may be outdated along with the age of the reading
3. THE Survivor_PWA SHALL store the following location metadata alongside the GPS coordinates: accuracy in meters, acquisition method (live fix or last known), and the timestamp of the reading, so that responders and dispatchers can assess position reliability
4. IF location permission is denied and no last known location exists, THEN THE Survivor_PWA SHALL still create the SOS without coordinates and inform the survivor that location could not be determined
5. IF a last known location exists but is older than 30 minutes, THEN THE Survivor_PWA SHALL treat it as unavailable, create the SOS without coordinates, and inform the survivor that no reliable location could be determined

---

### Requirement 3: Offline-First SOS Persistence

**User Story:** As a survivor, I want my SOS to be safely stored on my device regardless of connectivity, so that my emergency request is never lost.

#### Acceptance Criteria

1. THE Survivor_PWA SHALL store every created SOS in IndexedDB using Dexie, including SOS ID, emergency type, latitude, longitude, accuracy, timestamp, people count, description, priority, status, retry count, last transmission attempt, created-at, and updated-at fields
2. WHILE the device has no network connectivity, THE Survivor_PWA SHALL create and persist SOS records locally within 2 seconds of the user initiating the SOS, without requiring network access to complete the save
3. THE Survivor_PWA SHALL retain all locally stored SOS records until the Backend returns an acknowledgement response confirming successful receipt of that specific SOS record
4. IF the browser or device restarts after an SOS has been saved to IndexedDB, THEN THE Survivor_PWA SHALL retain the SOS record and resume delivery attempts within 10 seconds of the application becoming active
5. IF the IndexedDB write operation fails when persisting an SOS, THEN THE Survivor_PWA SHALL retry the write once and, if the retry also fails, display a notification indicating that the SOS could not be saved and prompt the user to try again
6. WHEN an SOS is created while the device has no network connectivity, THE Survivor_PWA SHALL assign the SOS record a status of "queued" to indicate it is awaiting transmission

---

### Requirement 4: Connectivity Status Indicator

**User Story:** As a survivor, I want to see my current connectivity status at all times, so that I understand whether my SOS can reach the emergency network immediately.

#### Acceptance Criteria

1. THE Survivor_PWA SHALL display a connectivity indicator showing one of three states: Connected (green), Weak Connection (amber), or Offline (red), where Connected means the device can reach the backend server, Weak Connection means the device has network access but requests are failing or round-trip latency exceeds 5 seconds, and Offline means no network access is detected
2. THE Survivor_PWA SHALL update the connectivity indicator within 5 seconds of a connectivity state change
3. WHILE the connectivity indicator shows Offline, THE Survivor_PWA SHALL display the message "SOS WILL BE SAVED" alongside the indicator
4. THE Survivor_PWA SHALL convey the connectivity state through both a text label and an icon in addition to color, so that status is distinguishable without relying on color perception alone
5. THE Survivor_PWA SHALL display the connectivity indicator in a fixed position visible on every screen without requiring the user to scroll
6. WHEN the Survivor_PWA launches and connectivity status has not yet been determined, THE Survivor_PWA SHALL display the indicator in the Offline state until the first successful or failed connectivity check completes

---

### Requirement 5: Automatic SOS Synchronization

**User Story:** As a survivor, I want my queued SOS requests to be automatically sent when connectivity returns, so that I do not have to manually resend them.

#### Acceptance Criteria

1. WHEN network connectivity returns, THE Sync_Engine SHALL attempt to deliver all queued SOS records to the Backend in creation-time order, processing each record sequentially so that a failed record does not block delivery of subsequent records
2. WHERE the browser supports Background Sync, THE Service_Worker SHALL register a sync event for pending SOS delivery
3. WHEN the Survivor_PWA regains focus or is reopened, THE Sync_Engine SHALL check for pending SOS records and attempt delivery only if a sync operation is not already in progress
4. IF an SOS delivery attempt fails, THEN THE Sync_Engine SHALL increment the retry count, record the last transmission attempt timestamp, and re-queue the SOS for subsequent retry using an exponential backoff strategy starting at 5 seconds and doubling on each attempt up to a maximum interval of 5 minutes
5. WHEN the Backend confirms receipt of an SOS, THE Sync_Engine SHALL update the local SOS status to Delivered and remove the record from the pending delivery queue
6. IF an SOS record has failed delivery for 10 consecutive attempts, THEN THE Sync_Engine SHALL mark the SOS status as Failed and cease automatic retry for that record until the next connectivity-change or app-focus event resets the retry cycle

---

### Requirement 6: SOS Delivery Transparency

**User Story:** As a survivor, I want the system to always be honest about whether my SOS has reached the emergency network, so that I can trust the information displayed.

#### Acceptance Criteria

1. THE Survivor_PWA SHALL display the actual delivery status of each SOS using the defined Incident_Lifecycle states and SHALL update the displayed status within 3 seconds of a state transition
2. WHILE an SOS has not been confirmed received by the Backend, THE Survivor_PWA SHALL NOT display any message indicating the SOS has been received by the emergency network
3. WHILE an SOS is in the Queued state (stored locally but not yet being transmitted), THE Survivor_PWA SHALL display "SOS saved. Waiting for connectivity."
4. WHILE an SOS is in the Sending state (actively being transmitted to the Backend), THE Survivor_PWA SHALL display a message indicating delivery is in progress
5. WHEN the Backend confirms receipt of an SOS, THE Survivor_PWA SHALL display "SOS received by the emergency network."
6. IF an SOS delivery attempt fails, THEN THE Survivor_PWA SHALL display a message indicating that delivery was unsuccessful and that the system will retry, and SHALL NOT display any message suggesting successful delivery

---

### Requirement 7: Local SOS Queue Visibility

**User Story:** As a survivor, I want to see all my pending SOS requests and their current statuses, so that I know what is queued and what has been delivered.

#### Acceptance Criteria

1. THE Survivor_PWA SHALL display a list of all locally stored SOS records, showing for each record: the SOS identifier, emergency type, and current delivery status (Queued, Retrying, Sending, Delivered, Failed), ordered by creation time with the most recent record first
2. WHEN the delivery status of any locally stored SOS record changes, THE Survivor_PWA SHALL update the displayed status within 3 seconds without requiring a manual page refresh
3. IF no locally stored SOS records exist, THEN THE Survivor_PWA SHALL display a message indicating that there are no emergency requests to show
4. WHILE the Survivor_PWA is offline, THE Survivor_PWA SHALL continue to display the locally stored SOS list and update statuses for local state transitions (e.g., Queued to Retrying) within 3 seconds

---

### Requirement 8: Service Worker Offline Shell

**User Story:** As a survivor, I want the emergency application to open and function even without internet, so that I can create an SOS regardless of connectivity.

#### Acceptance Criteria

1. WHEN the Service_Worker is installed, THE Service_Worker SHALL cache the application shell (HTML, CSS, JavaScript, icons, fonts, and required static assets) using a cache-first strategy so that all resources are available before the user first loses connectivity
2. WHILE the device has no network connectivity, THE Survivor_PWA SHALL load the emergency interface including the SOS creation screen, GPS capture, local storage, SOS history, and connectivity status indicator from the Service Worker cache within 4 seconds
3. THE Service_Worker SHALL use a network-first strategy for API requests with a timeout of 5 seconds, after which the Service_Worker SHALL fall back to the cached response if one exists
4. WHEN the Survivor_PWA is offline, THE Service_Worker SHALL serve the cached emergency interface without displaying a browser error page
5. WHEN a new version of the application shell is available, THE Service_Worker SHALL download updated assets in the background and activate the new cache upon the next application launch
6. IF the Service Worker cache is unavailable or empty when the device is offline, THEN THE Survivor_PWA SHALL display a message indicating that the application needs to be opened at least once while online before offline use is possible

---

### Requirement 9: Emergency Offline Mode

**User Story:** As a survivor, I want non-essential features to be hidden when I am offline, so that the interface remains focused on the emergency actions available to me.

#### Acceptance Criteria

1. WHILE the Survivor_PWA is offline, THE Survivor_PWA SHALL display only SOS creation, GPS status, local SOS storage, SOS history, and retry status features, and SHALL hide all other UI elements within 2 seconds of detecting loss of connectivity
2. WHILE the Survivor_PWA is offline, THE Survivor_PWA SHALL hide maps, analytics dashboards, animations, and any feature that requires an active network connection to function, removing them from the visible interface entirely rather than displaying them in a disabled or non-functional state
3. WHEN the Survivor_PWA detects that connectivity has been restored, THE Survivor_PWA SHALL restore all previously hidden features to the interface within 3 seconds and resume normal display mode

---

### Requirement 10: SOS Lifecycle Management

**User Story:** As a survivor, I want to see the progress of my SOS through each stage of the emergency response, so that I know help is on the way.

#### Acceptance Criteria

1. THE Backend SHALL transition each SOS through the defined Incident_Lifecycle states: Created → Saved → Queued → Sending → Delivered → Acknowledged → Dispatched → En Route → Arrived → Resolved, and SHALL reject any transition that does not follow a valid path in the lifecycle state machine
2. IF an SOS delivery fails during the Sending state, THEN THE Sync_Engine SHALL transition the SOS to a Failed state and retry by transitioning back to Queued, up to a maximum of 5 retry attempts with exponential delays between attempts
3. IF the Sync_Engine has exhausted all 5 retry attempts for an SOS, THEN THE Sync_Engine SHALL transition the SOS to a Permanently_Failed state and THE Survivor_PWA SHALL display a message indicating that delivery was unsuccessful and prompting the survivor to retry manually when connectivity improves
4. THE Backend SHALL record a timestamped event for every state transition in the SOS lifecycle, capturing the transition timestamp with second-level precision, the previous state, and the new state
5. THE Survivor_PWA SHALL display a timeline view showing all state transitions for each SOS ordered from oldest to newest, with their corresponding timestamps, and SHALL update the displayed timeline within 5 seconds of receiving a new state transition notification from the Backend

---

### Requirement 11: Push Notifications for Status Changes

**User Story:** As a survivor, I want to receive notifications when my SOS status changes, so that I am informed of progress even if the app is in the background.

#### Acceptance Criteria

1. WHEN an SOS transitions to Delivered, Acknowledged, Dispatched, En Route, Arrived, or Resolved, THE Backend SHALL send a push notification to the survivor's registered subscription within 5 seconds of the state transition
2. WHEN the survivor first creates an SOS and has not yet granted or denied push notification permission, THE Survivor_PWA SHALL request push notification permission and, upon approval, register the subscription with the Backend
3. IF the survivor denies or revokes push notification permission, THEN THE Survivor_PWA SHALL continue to function without push notifications and SHALL display status updates only when the survivor opens the application
4. WHEN a push notification is received, THE Survivor_PWA SHALL display a notification containing the SOS identifier and a status message indicating the new state (Delivered, Acknowledged, Dispatched, En Route, Arrived, or Resolved)
5. IF push notification delivery fails due to an expired or invalid subscription, THEN THE Backend SHALL mark the subscription as inactive and SHALL not retry delivery to that subscription until the Survivor_PWA re-registers

---

### Requirement 12: Optional Additional SOS Information

**User Story:** As a survivor, I want the option to provide additional details about my emergency after creating the SOS, so that responders can better prepare without delaying my initial request.

#### Acceptance Criteria

1. WHEN an SOS has been successfully created, THE Survivor_PWA SHALL optionally present fields for people count (single selection from: 1, 2, 3, 4, 5+), situation type (single selection from: Trapped, Injured, Stranded, Threatened, Missing, Other), and a free-text description of at most 200 characters
2. THE Survivor_PWA SHALL NOT require any additional information fields to be completed before the SOS is created and queued
3. WHEN additional information is provided after SOS creation, THE Survivor_PWA SHALL append the information to the existing SOS record and queue the update for sync to the Backend using the same offline-first delivery mechanism as the original SOS
4. WHEN additional information has been previously submitted for an SOS, THE Survivor_PWA SHALL allow the survivor to modify the people count, situation type, and description, and SHALL sync the updated values to the Backend

---

### Requirement 13: Optional User Profile

**User Story:** As a survivor, I want to optionally configure a profile with my name, language, emergency contact, household size, and accessibility needs, so that responders have useful context without being forced to register before requesting help.

#### Acceptance Criteria

1. THE Survivor_PWA SHALL provide an optional profile configuration screen with fields for: name (maximum 100 characters), preferred language (selectable from system-supported languages), emergency contact (maximum 20 characters), household size (integer from 1 to 99), and accessibility preferences (selectable options including large text, high contrast, reduced motion, and screen reader optimization)
2. THE Survivor_PWA SHALL NOT require profile completion before allowing SOS creation
3. WHEN a survivor has configured one or more profile fields and creates an SOS, THE Survivor_PWA SHALL include all populated profile fields with the SOS record sent to the Backend
4. THE Survivor_PWA SHALL persist profile data locally so that it is retained across application sessions and available offline
5. WHEN a survivor updates any profile field, THE Survivor_PWA SHALL save the change locally within 2 seconds and include the updated information with subsequent SOS records
6. IF a survivor submits a profile field that exceeds its maximum length or falls outside its valid range, THEN THE Survivor_PWA SHALL reject the input and display an inline error message indicating the constraint violated

---

### Requirement 14: Emergency Contact Notification

**User Story:** As a survivor, I want my designated emergency contact to be notified when my SOS reaches the backend, so that someone I trust is aware of my situation.

#### Acceptance Criteria

1. WHERE a survivor has configured an emergency contact, THE Backend SHALL send a notification to that contact when the SOS is received by the Backend
2. THE Backend SHALL include the survivor's name and the fact that an emergency request was created in the emergency contact notification
3. THE Survivor_PWA SHALL obtain the survivor's consent before enabling emergency contact notifications

---

### Requirement 15: Multilingual Support

**User Story:** As a survivor, I want to use the application in my preferred language, so that I can understand the interface during a stressful emergency.

#### Acceptance Criteria

1. THE Survivor_PWA SHALL support English and Hindi languages
2. THE Survivor_PWA SHALL use translation keys for all user-facing text rather than hardcoded strings
3. WHEN a survivor selects a preferred language, THE Survivor_PWA SHALL render all interface text in that language
4. THE Survivor_PWA SHALL store the language preference locally so it persists across sessions

---

### Requirement 16: Accessibility

**User Story:** As a survivor with accessibility needs, I want the emergency interface to be fully usable with assistive technologies and in challenging conditions, so that I can request help regardless of my abilities or environment.

#### Acceptance Criteria

1. THE Survivor_PWA SHALL use touch targets of at least 48x48 CSS pixels for all interactive elements
2. THE Survivor_PWA SHALL provide semantic HTML and ARIA labels compatible with screen readers
3. THE Survivor_PWA SHALL support high-contrast mode and color-independent status indicators
4. THE Survivor_PWA SHALL respect the prefers-reduced-motion media query and disable animations when set
5. THE Survivor_PWA SHALL support full keyboard navigation for all features
6. WHERE the device supports vibration, THE Survivor_PWA SHALL provide haptic feedback on SOS creation
7. THE Survivor_PWA SHALL provide an optional audio feedback mode that announces SOS creation audibly

---

### Requirement 17: Low-Battery Mode

**User Story:** As a survivor with low device battery, I want the application to reduce its resource consumption, so that my device remains operational longer for emergency communication.

#### Acceptance Criteria

1. WHEN low-battery mode is activated, THE Survivor_PWA SHALL disable animations, auto-refresh cycles, video content, heavy graphics, excessive location polling, and unnecessary API requests
2. THE Survivor_PWA SHALL allow the survivor to manually activate low-battery mode
3. WHILE low-battery mode is active, THE Survivor_PWA SHALL maintain full SOS creation, local storage, and delivery functionality

---

### Requirement 18: PWA Installation Experience

**User Story:** As a survivor, I want to install the emergency app on my device home screen, so that it feels like a native application and is quickly accessible in emergencies.

#### Acceptance Criteria

1. THE Survivor_PWA SHALL provide a web app manifest with application name, icons, theme color, standalone display mode, and splash screen configuration
2. THE Survivor_PWA SHALL support PWA install prompts where the browser provides them
3. THE Survivor_PWA SHALL define app shortcuts for emergency types (Request Rescue, Medical Help, Food/Water, My SOS) in the manifest

---

### Requirement 19: Responder Status Management

**User Story:** As a responder, I want to manage my availability status, so that the dispatch system knows whether I can accept new incidents.

#### Acceptance Criteria

1. THE Responder_PWA SHALL allow the responder to set their status to one of: Available, Busy, Assigned, En Route, On Scene, or Offline
2. WHEN a responder changes their status, THE Responder_PWA SHALL immediately transmit the status update to the Backend
3. THE Backend SHALL record every responder status change with a timestamp for audit purposes

---

### Requirement 20: Responder Incident Alert and Acceptance

**User Story:** As a responder, I want to receive incident alerts with relevant details and accept or decline them, so that I can respond to emergencies assigned to me.

#### Acceptance Criteria

1. WHEN the Geo_Dispatch_Engine assigns an incident to a responder, THE Responder_PWA SHALL display an alert containing the incident priority level, emergency type, distance from responder in kilometers, people count, and location coordinates
2. THE Responder_PWA SHALL present Accept and Decline actions for each incident alert and SHALL display the alert for a maximum of 120 seconds before treating it as no-response
3. WHEN a responder accepts an incident, THE Responder_PWA SHALL transition the responder status to En Route, display a confirmation indicating the assignment is active, and notify the Backend within 5 seconds of connectivity being available
4. WHEN a responder declines an incident, THE Responder_PWA SHALL notify the Backend so that the Geo_Dispatch_Engine can assign the next ranked responder
5. IF the Responder_PWA cannot reach the Backend after the responder accepts or declines, THEN THE Responder_PWA SHALL queue the response locally and retry delivery when connectivity is restored, displaying an indication that the response is pending synchronization
6. IF the responder does not act on the alert within 120 seconds, THEN THE Responder_PWA SHALL dismiss the alert and notify the Backend to trigger escalation to the next ranked responder

---

### Requirement 21: Responder Workflow Lifecycle

**User Story:** As a responder, I want a clear workflow from incident receipt through resolution, so that the system tracks my progress and the survivor receives accurate status updates.

#### Acceptance Criteria

1. THE Responder_PWA SHALL support the workflow states: Available → Incident Received → Accept → En Route → Arrived → Assisted → Resolved
2. WHEN a responder transitions between workflow states, THE Responder_PWA SHALL transmit the transition to the Backend within 3 seconds
3. THE Backend SHALL log every responder workflow transition with actor, timestamp, and incident reference

---

### Requirement 22: Responder Location Updates

**User Story:** As a dispatcher, I want to see responder locations in near real-time while they are actively using the app, so that I can make informed dispatch decisions.

#### Acceptance Criteria

1. WHILE the Responder_PWA is actively in use and location permission has been granted, THE Responder_PWA SHALL transmit location updates (latitude, longitude, accuracy, timestamp) to the Backend
2. THE Backend SHALL store each responder location update with a timestamp to enable Location_Freshness calculation
3. THE Responder_PWA SHALL request location permission from the responder and function without location data if permission is denied

---

### Requirement 23: Command Center Live Map

**User Story:** As a dispatcher, I want a live map showing all active incidents, responders, and stations, so that I have situational awareness of the entire operational area.

#### Acceptance Criteria

1. THE Command_Center SHALL display a Leaflet-based map showing active SOS incidents color-coded by type (red for Police/Rescue, blue for Medical, green for Food/Water, yellow for Children/Elderly)
2. THE Command_Center SHALL display responder positions on the map with icons indicating their type (police, ambulance, rescue team)
3. THE Command_Center SHALL display station locations (police stations, hospitals, relief centers) on the map
4. WHEN multiple SOS incidents are geographically close, THE Command_Center SHALL cluster them and display the count, with the ability to zoom into individual incidents
5. THE Command_Center SHALL update map positions in real-time via WebSocket/Socket.IO connections

---

### Requirement 24: Incident Queue and Filtering

**User Story:** As a dispatcher, I want to view and filter the incident queue, so that I can prioritize and manage emergencies efficiently.

#### Acceptance Criteria

1. THE Command_Center SHALL display an incident queue showing all active SOS requests with their type, priority, region, time since creation, and current status
2. THE Command_Center SHALL provide filters for emergency type (Police, Medical, Food, Vulnerable), priority (Critical, High, Medium, Low), region (state, district, area), time range (last 15 minutes, last hour, today, custom), and status
3. WHEN filters are applied, THE Command_Center SHALL update the incident queue to show only matching incidents within 2 seconds

---

### Requirement 25: Incident Details Panel

**User Story:** As a dispatcher, I want to view complete details of any incident, so that I can understand the situation before making dispatch decisions.

#### Acceptance Criteria

1. WHEN a dispatcher selects an incident, THE Command_Center SHALL display a details panel showing: SOS ID, emergency type, location coordinates, accuracy, people count, description, creation time, waiting duration, priority band, region, and current status
2. THE Command_Center SHALL display the full timeline of state transitions for the selected incident
3. THE Command_Center SHALL update the incident details panel in real-time as new events occur

---

### Requirement 26: Dispatch Panel and Responder Assignment

**User Story:** As a dispatcher, I want to see available responders ranked by suitability and assign them to incidents, so that the most appropriate responder is dispatched.

#### Acceptance Criteria

1. THE Command_Center SHALL display a dispatch panel showing available responders ranked by the Geo_Dispatch_Engine's suitability score
2. THE Command_Center SHALL display each responder's distance, availability status, and location freshness in the dispatch panel
3. WHEN a dispatcher selects a responder and initiates dispatch, THE Backend SHALL assign the incident to that responder and transition the SOS status to Dispatched
4. THE Command_Center SHALL allow dispatchers to override the Geo_Dispatch_Engine's recommendation and assign any available responder (human override)

---

### Requirement 27: Station and Facility Management

**User Story:** As an administrator, I want to manage hospitals, police stations, and relief centers in the system, so that the dispatch engine has accurate facility data.

#### Acceptance Criteria

1. THE Command_Center SHALL allow administrators to create, update, and deactivate police stations with location, jurisdiction, contact, officer count, and active status
2. THE Command_Center SHALL allow administrators to create, update, and deactivate hospitals with location, emergency contact, capacity, available services, and operating status
3. THE Command_Center SHALL allow administrators to create, update, and deactivate relief centers with location, type, and capacity
4. THE Backend SHALL validate that every station and facility has valid geographic coordinates before activation

---

### Requirement 28: Disaster Event Management

**User Story:** As an administrator, I want to create disaster events and associate SOS incidents with them, so that large-scale emergencies can be managed and analyzed as coordinated responses.

#### Acceptance Criteria

1. THE Command_Center SHALL allow administrators to create disaster events with event name, geographic region, severity, start date, end date, and status
2. THE Command_Center SHALL allow operators to associate individual SOS incidents with a disaster event
3. THE Command_Center SHALL display event-level analytics including total SOS count, breakdown by type, dispatch count, resolution count, and average acknowledgement/dispatch/arrival times

---

### Requirement 29: Region Detection and Routing

**User Story:** As a system operator, I want the backend to automatically detect which region an SOS belongs to based on GPS coordinates, so that incidents are routed to the correct jurisdiction.

#### Acceptance Criteria

1. WHEN the Backend receives an SOS with GPS coordinates, THE Geo_Dispatch_Engine SHALL determine the geographic region containing those coordinates using boundary lookup within 2 seconds of receipt
2. WHEN the region is determined, THE Geo_Dispatch_Engine SHALL route the SOS to the responder pool associated with that region and emergency type, and record the assigned region identifier on the incident
3. IF an SOS location does not fall within any defined region boundary, THEN THE Geo_Dispatch_Engine SHALL assign the incident an "unresolved region" status, display it in the Command Center dispatch queue with a visible indicator that manual region assignment is required, and retain the original GPS coordinates for the dispatcher to review
4. IF an SOS is received with invalid or missing GPS coordinates, THEN THE Geo_Dispatch_Engine SHALL assign the incident an "unresolved location" status and place it in the Command Center dispatch queue for manual review within 5 seconds of receipt

---

### Requirement 30: Emergency-Type Responder Routing

**User Story:** As a system operator, I want different emergency types to be routed to appropriate responder pools, so that survivors receive help from personnel qualified for their specific emergency.

#### Acceptance Criteria

1. WHEN an SOS of type Police/Rescue is received, THE Geo_Dispatch_Engine SHALL route to police officers, rescue teams, and disaster response teams
2. WHEN an SOS of type Medical is received, THE Geo_Dispatch_Engine SHALL route to ambulances, medical responders, and identify appropriate hospitals
3. WHEN an SOS of type Food/Water is received, THE Geo_Dispatch_Engine SHALL route to relief teams, local administration, and relief distribution centers
4. WHEN an SOS of type Children/Elderly is received, THE Geo_Dispatch_Engine SHALL route to appropriate rescue/social-response teams, police where necessary, and medical services when required

---

### Requirement 31: Responder Ranking and Selection

**User Story:** As a system operator, I want the dispatch engine to rank available responders by suitability, so that the most appropriate responder is recommended for each incident.

#### Acceptance Criteria

1. THE Geo_Dispatch_Engine SHALL rank available responders by evaluating: distance to incident, availability status, emergency type match, jurisdiction, location freshness, vehicle availability, and incident priority, and SHALL present no more than 10 ranked responders to the dispatcher
2. THE Geo_Dispatch_Engine SHALL exclude responders with status Busy or Offline from ranking
3. IF a responder's location freshness exceeds the configured staleness threshold (default: 5 minutes), THEN THE Geo_Dispatch_Engine SHALL rank that responder below all responders whose location freshness is within the threshold
4. THE Geo_Dispatch_Engine SHALL present ranked responders as recommendations to the dispatcher, not as autonomous dispatch decisions
5. IF no eligible responders remain after filtering, THEN THE Geo_Dispatch_Engine SHALL indicate to the dispatcher that no suitable responders are available for the incident
6. IF two or more responders receive an equal suitability score, THEN THE Geo_Dispatch_Engine SHALL rank the responder with the most recent location update higher

---

### Requirement 32: Location Freshness Validation

**User Story:** As a dispatcher, I want stale responder locations to be flagged, so that dispatch decisions are based on reliable position data.

#### Acceptance Criteria

1. THE Geo_Dispatch_Engine SHALL calculate Location_Freshness as the elapsed time since a responder's last location update
2. WHEN a responder's Location_Freshness exceeds the configured staleness threshold, THE Geo_Dispatch_Engine SHALL flag that responder's location as potentially unreliable in the dispatch panel
3. THE Command_Center SHALL display the Location_Freshness value alongside each responder in the dispatch panel

---

### Requirement 33: Dispatch Escalation

**User Story:** As a system operator, I want unacknowledged dispatches to escalate automatically, so that no incident remains unattended due to responder non-response.

#### Acceptance Criteria

1. IF a dispatched responder does not acknowledge within the configured timeout period, THEN THE Geo_Dispatch_Engine SHALL escalate to the next ranked responder
2. IF all individual responders in the ranking fail to acknowledge, THEN THE Geo_Dispatch_Engine SHALL escalate to the station dispatcher
3. IF the station dispatcher does not respond within the configured timeout, THEN THE Geo_Dispatch_Engine SHALL escalate to a supervisor
4. THE Backend SHALL allow administrators to configure escalation timeout periods based on priority band

---

### Requirement 34: SOS Deduplication

**User Story:** As a dispatcher, I want duplicate SOS submissions to be detected and flagged, so that the same emergency does not consume multiple responder resources.

#### Acceptance Criteria

1. WHEN a new SOS is received, THE Backend SHALL check for potential duplicates using device/session identifier, location proximity, timestamp proximity, and emergency category
2. WHEN a potential duplicate is detected, THE Backend SHALL flag the SOS as "Possible duplicate incident" for dispatcher review rather than automatically discarding it
3. THE Command_Center SHALL display duplicate flags on affected incidents and allow the dispatcher to merge or dismiss the duplicate

---

### Requirement 35: Priority Engine Scoring

**User Story:** As a dispatcher, I want each SOS to have a calculated priority score, so that critical emergencies are surfaced and handled first.

#### Acceptance Criteria

1. THE Priority_Engine SHALL calculate a priority score for each SOS by summing the following factors: Medical emergency (+40), Vulnerable people (Children/Elderly) (+25), 5 or more people (+20), Waiting time exceeding 15 minutes (+15), High-risk zone as defined by active Disaster Event regions (+20), and SHALL cap the total score at 100
2. THE Priority_Engine SHALL assign a Priority_Band based on the capped score: 81–100 Critical, 61–80 High, 31–60 Medium, 0–30 Low
3. IF one or more scoring factors cannot be determined due to missing SOS data (e.g., people count not provided), THEN THE Priority_Engine SHALL calculate the score using only the available factors and exclude the indeterminate factors from the sum
4. WHEN SOS data is updated (additional information added, people count changed, or waiting time crosses the 15-minute threshold), THE Priority_Engine SHALL recalculate the priority score and update the Priority_Band within 5 seconds of the data change
5. THE Priority_Engine SHALL display the priority score and Priority_Band alongside dispatcher-actionable controls (assign, reassign, override priority), indicating that the score is a recommendation subject to dispatcher judgment

---

### Requirement 36: Role-Based Access Control

**User Story:** As an administrator, I want users to be assigned roles with specific permissions, so that each user can only access functionality appropriate to their responsibility.

#### Acceptance Criteria

1. THE Backend SHALL enforce six roles with the following permission scopes: Survivor (create and track own SOS only), Responder (view and act on assigned incidents only), Dispatcher (create, view, assign, and update all incidents within their region), Supervisor (view all incidents, responders, and operational metrics within their region), Administrator (full access to all system configuration, users, regions, and operations), and Auditor (read-only access to historical incidents, audit logs, and analytics)
2. THE Backend SHALL assign exactly one role per user account at any given time
3. IF an authenticated user's role does not have permission for the requested action, THEN THE Backend SHALL reject the request with an authorization error response and shall not execute the requested action
4. WHEN a user attempts to access a resource outside their role permissions, THE Backend SHALL log the attempt including the user identifier, the requested action, the target resource, and the timestamp
5. WHEN an administrator changes a user's role, THE Backend SHALL apply the new permissions to all subsequent requests from that user within 60 seconds of the change

---

### Requirement 37: Authentication and Session Security

**User Story:** As a system operator, I want strong authentication for administrative and responder interfaces with minimal friction for survivors, so that the system is secure without impeding emergency access.

#### Acceptance Criteria

1. THE Backend SHALL require authentication for Responder, Dispatcher, Supervisor, Administrator, and Auditor roles
2. THE Backend SHALL require multi-factor authentication for Dispatcher, Supervisor, and Administrator roles
3. THE Backend SHALL enforce session expiry after a configurable inactivity period
4. THE Backend SHALL support device and session management allowing users to view and revoke active sessions
5. THE Survivor_PWA SHALL NOT require authentication or profile completion before allowing SOS creation

---

### Requirement 38: Security Controls

**User Story:** As a system operator, I want comprehensive security controls protecting the platform, so that the system is resilient against common attack vectors.

#### Acceptance Criteria

1. THE Backend SHALL enforce HTTPS for all communications
2. THE Backend SHALL validate and sanitize all input data before processing
3. THE Backend SHALL implement rate limiting on all API endpoints
4. THE Backend SHALL set secure HTTP headers including Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, and Strict-Transport-Security
5. THE Backend SHALL implement XSS protection through output encoding and Content-Security-Policy
6. THE Backend SHALL implement CSRF protection for state-changing requests where applicable
7. THE Backend SHALL use secure cookie attributes (HttpOnly, Secure, SameSite) for session management

---

### Requirement 39: False SOS Protection

**User Story:** As a system operator, I want mechanisms to detect and mitigate false or abusive SOS submissions, so that real emergencies are not drowned out by misuse.

#### Acceptance Criteria

1. THE Backend SHALL enforce rate limiting on SOS creation per device/session to prevent repeated abuse
2. THE Backend SHALL flag SOS submissions that match suspicious behavior patterns (rapid repeated submissions, impossible location changes)
3. THE Backend SHALL present suspicious SOS flags to dispatchers for human verification rather than automatically blocking submissions

---

### Requirement 40: Audit Trail

**User Story:** As an auditor, I want a complete, immutable record of every significant action taken on every incident, so that operations can be reviewed and accountability maintained.

#### Acceptance Criteria

1. THE Backend SHALL record an audit event for every SOS state transition, containing the SOS ID, event type, actor ID, timestamp (UTC, millisecond precision), previous state, new state, and the request-specific data that triggered the transition (e.g., location coordinates for creation, responder ID for assignment)
2. THE Backend SHALL record an audit event for every dispatch decision, responder assignment, override, and escalation, containing the SOS ID, event type, actor ID, timestamp (UTC, millisecond precision), and action-specific parameters (e.g., assigned responder ID, override reason, escalation level)
3. THE Backend SHALL record an audit event for every authentication event, role change, and administrative configuration change, containing the actor ID, event type, timestamp (UTC, millisecond precision), target entity ID, and the before/after values of any changed field
4. THE Audit trail SHALL be append-only; THE Backend SHALL NOT allow modification or deletion of audit records through any API endpoint or user-facing operation
5. IF the Backend fails to persist an audit event, THEN THE Backend SHALL reject the originating operation and return an error indicating that the action could not be completed
6. WHEN an auditor queries the audit trail, THE Backend SHALL return audit events filtered by SOS ID, actor ID, event type, or time range, ordered by timestamp, in pages of up to 100 records per response

---

### Requirement 41: Response Metrics

**User Story:** As a supervisor, I want to monitor key response time metrics, so that I can identify bottlenecks and improve emergency response performance.

#### Acceptance Criteria

1. THE Command_Center SHALL calculate and display acknowledgement time (SOS creation to operator acknowledgement)
2. THE Command_Center SHALL calculate and display dispatch time (SOS creation to responder assignment)
3. THE Command_Center SHALL calculate and display travel time (dispatch to responder arrival)
4. THE Command_Center SHALL calculate and display resolution time (SOS creation to incident resolution)
5. THE Command_Center SHALL calculate and display delivery time (SOS creation to Backend reception)

---

### Requirement 42: System Health Monitoring

**User Story:** As a system operator, I want to see the health status of all platform components, so that I can detect and respond to degraded services quickly.

#### Acceptance Criteria

1. THE Command_Center SHALL display real-time health status for: API server, Database, Notification service, Real-time (WebSocket) service, and Sync service
2. WHEN a monitored service becomes degraded or unavailable, THE Command_Center SHALL display a warning indicator identifying the affected service
3. THE Command_Center SHALL update health status indicators within 30 seconds of a service state change

---

### Requirement 43: Real-Time Updates

**User Story:** As a dispatcher, I want the Command Center to reflect changes in real-time without manual refresh, so that I have current situational awareness at all times.

#### Acceptance Criteria

1. WHEN the Command_Center interface loads, THE Command_Center SHALL establish a WebSocket/Socket.IO connection to the Backend for real-time event streaming within 5 seconds of page load completion
2. WHEN an SOS is created, updated, or transitions state, THE Backend SHALL broadcast the event to all connected Command_Center clients within 2 seconds
3. WHEN a responder location or status changes, THE Backend SHALL broadcast the update to all connected Command_Center clients within 2 seconds
4. IF the WebSocket connection is lost, THEN THE Command_Center SHALL attempt automatic reconnection using a maximum of 10 retry attempts with exponential backoff starting at 1 second, and SHALL display a visible connection-status indicator to the operator showing the degraded state
5. IF all reconnection attempts are exhausted without success, THEN THE Command_Center SHALL display a persistent disconnected-state indicator and provide the operator with a manual reconnect action
6. WHEN the WebSocket connection is re-established after a disconnection, THE Command_Center SHALL request any events missed during the disconnection period from the Backend and restore the connection-status indicator to the normal connected state

---

### Requirement 44: ConnectivityManager Abstraction

**User Story:** As a platform architect, I want communication to be abstracted behind a ConnectivityManager interface, so that future native mesh communication can be added without rewriting the application.

#### Acceptance Criteria

1. THE Survivor_PWA SHALL implement a ConnectivityManager interface exposing getStatus(), sendSOS(), retryPendingSOS(), and getDeliveryStatus() methods, where SOS creation and queue management logic depend only on this interface and not on any specific provider implementation
2. THE ConnectivityManager getStatus() method SHALL return one of the following connectivity states: Connected, Weak Connection, or Offline
3. THE ConnectivityManager SHALL have a WebConnectivityProvider implementation for the current PWA phase that communicates via standard HTTP/HTTPS
4. IF a call to sendSOS() or retryPendingSOS() fails due to a provider error, THEN THE ConnectivityManager SHALL return a failure outcome to the caller without altering the locally stored SOS record, so that the SOS remains available for future retry
5. WHEN a new provider implementation is substituted for WebConnectivityProvider, THE Survivor_PWA SHALL require no changes to SOS creation, queue management, or status display logic beyond provider instantiation configuration

---

### Requirement 45: SOS History and Timeline

**User Story:** As a survivor, I want to view my past emergency requests and the detailed timeline of each, so that I have a record of my interactions with the emergency system.

#### Acceptance Criteria

1. THE Survivor_PWA SHALL display a list of all the survivor's past SOS requests showing SOS identifier, emergency type, status, and creation date/time
2. WHEN a survivor selects an SOS from the history list, THE Survivor_PWA SHALL display a chronological timeline of all state transitions with timestamps
3. THE Survivor_PWA SHALL load SOS history from local IndexedDB when offline and from the Backend when online

---

### Requirement 46: Cache Strategy

**User Story:** As a platform architect, I want defined caching strategies for different resource types, so that the application balances freshness with offline availability.

#### Acceptance Criteria

1. THE Service_Worker SHALL apply a cache-first strategy for the emergency application shell (HTML, CSS, JavaScript, icons, fonts)
2. THE Service_Worker SHALL apply a network-first strategy for API requests
3. THE Service_Worker SHALL apply a cache-first with periodic update strategy for static configuration data
4. THE Service_Worker SHALL apply a network-first strategy for live dashboard and real-time data
