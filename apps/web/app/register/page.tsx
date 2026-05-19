import { RegisterForm } from "@/components/auth/register-form";

export default function RegisterPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[--nav-bg]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <h1 className="text-5xl font-black text-white tracking-tight" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
            INNEX
          </h1>
          <p className="text-[--text-nav-muted] mt-3 text-sm">创建你的知识库</p>
        </div>
        <div className="bg-white rounded-xl p-8 shadow-lg">
          <h2 className="text-lg font-semibold mb-6 text-center">注册</h2>
          <RegisterForm />
        </div>
      </div>
    </div>
  );
}
