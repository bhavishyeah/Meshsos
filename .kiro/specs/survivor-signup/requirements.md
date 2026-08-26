# Requirements Document

## Introduction

MeshSOS is an emergency SOS platform (PWA) that currently allows survivors to send SOS requests anonymously via device-session-based identification. This feature introduces an optional public sign-up flow so survivors can create accounts to gain persistent SOS history across devices, while preserving the existing anonymous SOS flow for users who choose not to register.

## Glossary

- **Signup_Page**: The public-facing registration form at route `#/signup` where survivors enter their name, email, and password to create an account.
- **Registration_API**: The backend endpoint `POST /api/auth/register` that processes self-registration requests and creates survivor accounts.
- **Survivor**: A self-registered user with the role `survivor` who can send SOS requests and access persistent history across devices.
- **Anonymous_Mode**: The existing device-session-based flow where users can send SOS without creating an account.
- **Auth_Context**: The React context that manages authentication state including login, logout, token refresh, and session persistence.
- **Verification_Email**: An optional email sent to the registrant's address containing a link or code to confirm email ownership.

## Requirements

### Requirement 1: Survivor Self-Registration API

**User Story:** As a survivor, I want to register for an account with my name, email, and password, so that I can access persistent SOS history across my devices.

#### Acceptance Criteria

1. WHEN a valid registration request is received with name, email, and password, THE Registration_API SHALL create a new user record with the role set to `survivor` and return an access token and user object.
2. WHEN a registration request is received with an email that already exists in the system, THE Registration_API SHALL return a 409 status code with an error message indicating the email is already in use.
3. WHEN a registration request is received with a password shorter than 8 characters, THE Registration_API SHALL return a 400 status code with an error message indicating the minimum password length requirement.
4. WHEN a registration request is received with a missing or invalid email address, THE Registration_API SHALL return a 400 status code with an error message indicating a valid email is required.
5. WHEN a registration request is received with a missing or empty name, THE Registration_API SHALL return a 400 status code with an error message indicating name is required.
6. THE Registration_API SHALL hash passwords using bcrypt with a cost factor of 12 before storing them.
7. WHEN a user is successfully registered, THE Registration_API SHALL set an HTTP-only refresh token cookie and return an access token in the response body.

### Requirement 2: Signup Page UI

**User Story:** As a survivor on a mobile device, I want a simple and fast sign-up form, so that I can create an account without friction during or after an emergency.

#### Acceptance Criteria

1. THE Signup_Page SHALL display a form with fields for name, email, and password at route `#/signup`.
2. THE Signup_Page SHALL use a mobile-first layout that is usable on screens as narrow as 320px.
3. WHEN the form is submitted with valid inputs, THE Signup_Page SHALL send a registration request to the Registration_API and display a loading state on the submit button.
4. WHEN registration succeeds, THE Signup_Page SHALL store the returned access token and user data in Auth_Context and redirect the user to the home route `#/`.
5. WHEN registration fails, THE Signup_Page SHALL display the error message returned by the Registration_API in a visible alert element with role `alert`.
6. THE Signup_Page SHALL include a link to the login page (`#/login`) with text indicating existing users can sign in.
7. THE Signup_Page SHALL validate that password is at least 8 characters before submitting and display an inline validation message when the requirement is not met.

### Requirement 3: Login-to-Signup Navigation

**User Story:** As a user on the login page, I want a link to the sign-up page, so that I can create an account if I do not have one.

#### Acceptance Criteria

1. THE LoginPage SHALL display a link to the signup route `#/signup` with text indicating new users can create an account.
2. THE Signup_Page SHALL display a link to the login route `#/login` with text indicating existing users can sign in.

### Requirement 4: Signup Route Registration

**User Story:** As a user, I want the signup page to be accessible via the `#/signup` URL, so that I can navigate to it directly or via links.

#### Acceptance Criteria

1. WHEN the route `#/signup` is active, THE App SHALL render the Signup_Page component.
2. THE App SHALL render the Signup_Page without requiring authentication.

### Requirement 5: Anonymous Mode Preservation

**User Story:** As a survivor who chooses not to register, I want to continue sending SOS requests without an account, so that the sign-up feature does not block emergency usage.

#### Acceptance Criteria

1. THE App SHALL continue to allow SOS creation from the home route `#/` without requiring authentication.
2. WHEN a user is not authenticated, THE App SHALL use device-session-based identification for SOS requests as it does today.

### Requirement 6: Persistent History for Registered Survivors

**User Story:** As a registered survivor, I want my SOS history to be tied to my account, so that I can access it from any device after logging in.

#### Acceptance Criteria

1. WHEN an authenticated Survivor creates an SOS request, THE App SHALL associate the SOS record with the Survivor's user ID.
2. WHEN an authenticated Survivor views the SOS queue, THE App SHALL display SOS records associated with the Survivor's user ID regardless of which device was used to create them.

### Requirement 7: Email Verification (Optional)

**User Story:** As a platform operator, I want survivors to verify their email addresses, so that account recovery and communication remain reliable.

#### Acceptance Criteria

1. WHEN a Survivor successfully registers, THE Registration_API SHALL send a Verification_Email to the provided email address containing a unique verification link.
2. WHEN the Survivor clicks the verification link, THE Registration_API SHALL mark the email as verified in the user record.
3. WHILE a Survivor's email is not verified, THE App SHALL display a non-blocking banner prompting the user to verify their email.
4. WHILE a Survivor's email is not verified, THE App SHALL still allow the Survivor to send SOS requests and access all features.
