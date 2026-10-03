import { LoginForm } from "../../components/auth/LoginForm";

export default function Login() {
  return (
    <main>
      <h1>Face ID</h1>
      <p>Sign in to recognize and manage the people you have enrolled. Each account only sees its own data.</p>
      <LoginForm />
    </main>
  );
}
