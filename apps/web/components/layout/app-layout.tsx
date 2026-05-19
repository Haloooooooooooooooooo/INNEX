import { Nav } from "@/components/layout/nav";
import { TopBar } from "@/components/layout/topbar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Nav />
        <main className="flex-1 overflow-auto bg-[--paper]">{children}</main>
      </div>
    </div>
  );
}
