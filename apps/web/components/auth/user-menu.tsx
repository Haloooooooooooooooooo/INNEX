"use client";

import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu() {
  const { user, signOut } = useAuth();

  if (!user) return null;

  const email = user.email ?? "";
  const initial = email.charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="w-[42px] h-[42px] rounded-lg border border-white/18 bg-black/76 text-[#d8d3ca] backdrop-blur-[10px] flex items-center justify-center cursor-pointer text-sm hover:bg-[--innex-accent-dim] hover:text-white hover:border-[--innex-accent]/45 transition-all duration-150">
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent alignOffset={-60} className="w-56">
        <div className="px-3 py-2 text-sm text-muted-foreground truncate">
          {email}
        </div>
        <DropdownMenuItem onClick={signOut} className="cursor-pointer text-red-500">
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
