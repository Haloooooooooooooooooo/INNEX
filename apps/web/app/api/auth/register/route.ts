import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { email, password, username } = await request.json();
  const normalizedUsername = typeof username === "string" ? username.trim() : "";

  if (!email || !password || !normalizedUsername) {
    return NextResponse.json({ error: "Email, password and username required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: normalizedUsername,
        full_name: normalizedUsername,
      },
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ user: data.user });
}
