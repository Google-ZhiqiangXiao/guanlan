"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-3xl border border-[#efc7bf] bg-[#f8ebe6] p-6">
      <h1 className="font-serif text-3xl">页面出错了</h1>
      <p className="mt-2 text-sm">{error.message}</p>
      <button className="mt-4 rounded-full bg-[var(--tide)] px-4 py-2 text-sm text-white" onClick={reset}>
        重试
      </button>
    </div>
  );
}
