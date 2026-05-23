"use client";

interface InfoModalProps {
  open: boolean;
  onClose: () => void;
  date?: string;
}

export function InfoModal({ open, onClose, date = "2026-05-19" }: InfoModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-[4px] z-[300] flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex gap-4">
        {/* Info Card */}
        <div className="bg-white rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.2)] p-5 w-[300px]">
          <div className="text-xs font-bold text-[--text-primary] tracking-[0.06em] uppercase mb-3.5 pb-2.5 border-b border-[--border-light]">
            今日信息卡 · {date}
          </div>

          <div className="flex gap-2 mb-3.5">
            <div className="flex-1 text-center bg-[--paper] rounded-lg py-2.5 px-1.5 cursor-pointer hover:bg-[--innex-accent-dim] transition-colors">
              <div className="text-xl font-bold text-[--innex-accent]">-</div>
              <div className="text-[9px] text-[--text-muted] mt-0.5">稍后看</div>
            </div>
            <div className="flex-1 text-center bg-[--paper] rounded-lg py-2.5 px-1.5 cursor-pointer hover:bg-[--innex-accent-dim] transition-colors">
              <div className="text-xl font-bold text-[--innex-accent]">-</div>
              <div className="text-[9px] text-[--text-muted] mt-0.5">待内化</div>
            </div>
            <div className="flex-1 text-center bg-[--paper] rounded-lg py-2.5 px-1.5 cursor-pointer hover:bg-[--innex-accent-dim] transition-colors">
              <div className="text-xl font-bold text-[--innex-accent]">-</div>
              <div className="text-[9px] text-[--text-muted] mt-0.5">已沉淀新增</div>
            </div>
          </div>

          <div className="text-[11px] font-bold text-[--text-muted] uppercase tracking-[0.05em] mb-2">
            今日建议处理
          </div>
          <div className="flex flex-col gap-2">
            <div className="bg-[--paper] rounded-lg p-2.5">
              <div className="text-[9px] font-bold text-[--innex-accent] mb-0.5">01</div>
              <div className="text-[11px] font-medium text-[--text-primary] mb-0.5">
                收录箱中有等待内化的内容
              </div>
              <div className="text-[10px] text-[--text-secondary]">
                点击下方 Tab 查看待内化列表
              </div>
            </div>
            <div className="bg-[--paper] rounded-lg p-2.5">
              <div className="text-[9px] font-bold text-[--innex-accent] mb-0.5">02</div>
              <div className="text-[11px] font-medium text-[--text-primary] mb-0.5">
                养成每日收录的习惯
              </div>
              <div className="text-[10px] text-[--text-secondary]">
                看到有价值的内容就收录进来
              </div>
            </div>
          </div>
        </div>

        {/* Week Card */}
        <div className="bg-white rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.2)] p-5 w-[260px]">
          <div className="text-xs font-bold text-[--text-primary] tracking-[0.06em] uppercase mb-3.5 pb-2.5 border-b border-[--border-light]">
            本周反馈
          </div>
          <div className="flex flex-col">
            <div className="flex items-center justify-between py-1.5 border-b border-[--border-light] text-xs">
              <span className="text-[--text-secondary]">本周新增记录</span>
              <span className="font-semibold text-[--text-primary]">- 条</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-[--border-light] text-xs">
              <span className="text-[--text-secondary]">本周已沉淀</span>
              <span className="font-semibold text-[--text-primary]">- 条</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-[--border-light] text-xs">
              <span className="text-[--text-secondary]">关注主题 Top3</span>
              <span className="font-semibold text-[--text-primary]">收录中</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-[--border-light] text-xs">
              <span className="text-[--text-secondary]">可复用笔记</span>
              <span className="font-semibold text-[--text-primary]">- 条</span>
            </div>
            <div className="flex items-center justify-between pt-2.5 text-xs">
              <span className="text-[--innex-accent] font-semibold">下周建议补强</span>
              <span className="text-[--innex-accent] font-semibold">知识系统</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
