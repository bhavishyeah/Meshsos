# Implementation Plan: Survivor Signup

## Overview

Add a public self-registration flow for survivors: a `POST /api/auth/register` backend endpoint, a `SignupPage` frontend component, route wiring, login page link, and SyncEngine userId injection. Reuses existing `createUser()` and `login()` services. Email verification is deferred.

## Tasks

- [ ] 1. Backend registration endpoint and role extension
  - [ ] 1.1 Extend UserService to accept 'survivor' role for self-registration
    - Add a `SELF_REGISTER_ROLES` constant containing `['survivor']` in `backend/src/services/user.service.ts`
    - Create a `registerSurvivor(name, email, password)` function that calls `createUser` with role `'survivor'`, using `SELF_REGISTER_ROLES` for validation instead of `VALID_ROLES`
    - _Requirements: 1.1, 1.6_

  - [ ] 1.2 Add POST /api/auth/register route to auth.routes.ts
    - Add a new `router.post('/register', ...)` handler in `backend/src/routes/auth.routes.ts`
    - Validate inputs: name non-empty, email contains '@', password >= 8 chars
    - Call `registerSurvivor(name, email, password)` from user service
    - Call `login(email, password)` from auth service to create session and issue tokens
    - Set refresh token cookie using existing `setRefreshCookie()` helper
    - Return `{ accessToken, user: { id, role, name, email } }` on success
    - Return 400 for validation errors, 409 for duplicate email (map `UserServiceError` status codes)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_

  - [ ]* 1.3 Write property-based tests for registration endpoint
    - **Property 1: Valid Registration Produces Correct Response** — generate random valid (name, email, password) → verify 200, role is 'survivor', accessToken present
    - **Property 2: Short Passwords Are Rejected** — generate passwords of length 0-7 → verify 400
    - **Property 3: Invalid Required Fields Are Rejected** — generate invalid emails and empty names → verify 400
    - **Property 4: Password Storage Uses Bcrypt Cost 12** — register, then verify stored hash is bcrypt cost-12
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6**

- [ ] 2. Frontend SignupPage and routing
  - [ ] 2.1 Create SignupPage component
    - Create `frontend/src/features/auth/SignupPage.tsx` following `LoginPage.tsx` patterns
    - Form fields: name, email, password with appropriate labels and types
    - Client-side validation: inline message when password < 8 characters, prevent submission
    - Submit handler: POST to `${API_BASE_URL}/api/auth/register` with `{ name, email, password }`
    - Loading state on submit button during request
    - On success: call `completeLogin(user, accessToken)` from AuthContext, redirect to `#/`
    - On failure: display error in `<div role="alert">` matching LoginPage pattern
    - Include link to `#/login` for existing users ("Already have an account? Sign in")
    - Mobile-first layout, usable at 320px width
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.2_

  - [ ] 2.2 Add signup route in App.tsx and login page link
    - Add `if (route === '/signup') return <SignupPage />;` in `frontend/src/App.tsx` before the admin route check, no `ProtectedRoute` wrapper
    - Add a "Create an account" link to `#/signup` in `frontend/src/features/auth/LoginPage.tsx`
    - _Requirements: 3.1, 4.1, 4.2_

  - [ ]* 2.3 Write unit tests for SignupPage
    - Test form renders with name, email, password fields
    - Test inline validation message for short passwords
    - Test successful submission calls completeLogin and redirects
    - Test error display in role="alert" element
    - Test link to login page is present
    - _Requirements: 2.1, 2.5, 2.7_

- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. SyncEngine userId injection
  - [ ] 4.1 Add userId to SOS delivery payload when authenticated
    - Add a `setUserIdGetter` / `getUserId` pattern in `frontend/src/services/sync-engine.service.ts` (similar to `setTokenGetter` in `api.ts`)
    - In `attemptDelivery()`, include `userId` in the POST body when `getUserId()` returns a non-null value
    - Wire `setUserIdGetter` in `AuthContext` on mount (or via a dedicated hook), sourcing from `state.user?.id`
    - _Requirements: 6.1_

  - [ ]* 4.2 Write property-based test for userId injection
    - **Property 5: Authenticated SOS Includes User ID** — generate random userIds, mock getUserId to return them → verify POST body contains matching userId
    - **Validates: Requirements 6.1**

- [ ] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Email verification (Requirement 7) is explicitly deferred to a future iteration
- The existing anonymous SOS flow (Requirement 5) is preserved — no changes to the default unauthenticated path
- Property tests use `fast-check` which is already in the project's test dependencies
- Each task references specific requirements for traceability

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["1.3", "2.3", "4.1"] },
    { "id": 3, "tasks": ["4.2"] }
  ]
}
```
