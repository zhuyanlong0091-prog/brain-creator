export const metadata = {
  title: "真实页面建模 Fixture"
};

export default function ModelTargetFixturePage() {
  return (
    <main style={{ display: "grid", gap: 16, padding: 32 }}>
      <h1>真实页面建模 Fixture</h1>
      <p>这是给 Brain Creator 真实浏览器采集使用的本地页面。</p>
      <button data-brain-label="create-order" type="button">
        Create Order
      </button>
      <label>
        Search orders
        <input aria-label="Search orders" name="orders-search" placeholder="Search" />
      </label>
      <script
        dangerouslySetInnerHTML={{
          __html: 'console.error("fixture console failure")'
        }}
      />
    </main>
  );
}
