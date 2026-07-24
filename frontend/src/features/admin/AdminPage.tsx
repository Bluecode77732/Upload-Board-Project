// Purpose: placeholder for the /admin route section (ADR 0010 — admin lives inside this frontend).
// Usage: rendered at /admin behind RequireAuth; real admin capability waits on backend RBAC (Stage 0).
// Rationale: reserving the route now fixes the ADR 0010 "admin as an /admin section" decision in code;
//   it stays a stub until roles exist server-side, so it must not imply privileged access yet.

export function AdminPage() {
  return (
    <main style={{ maxWidth: 720, margin: '5vh auto', padding: 24 }}>
      <h1>Admin</h1>
      <p>
        Reserved for the admin section (ADR 0010). Role-gated features arrive with backend RBAC
        (Stage 0) — until then this route carries no elevated privileges.
      </p>
    </main>
  )
}
