import { headers } from "next/headers";

export const metadata = {
  title: "私有页面建模 Fixture"
};

export default async function PrivateTargetFixturePage() {
  const requestHeaders = await headers();
  const authorized = requestHeaders.get("authorization") === "Bearer local-secret-token";

  if (!authorized) {
    return (
      <main style={{ display: "grid", gap: 16, padding: 32 }}>
        <h1>未授权页面</h1>
        <p>这个页面需要 Brain Creator 注入测试 Token 后才能采集。</p>
      </main>
    );
  }

  return (
    <main style={{ display: "grid", gap: 16, padding: 32 }}>
      <h1>私有页面建模 Fixture</h1>
      <p>这是给 Brain Creator 验证鉴权注入的本地私有页面。</p>
      <button data-brain-label="private-submit" type="button">
        Private Submit
      </button>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            document.querySelector("[data-brain-label='private-submit']").addEventListener("click", () => {
              fetch("/api/orders", { method: "POST" });
            });
          `
        }}
      />
    </main>
  );
}
