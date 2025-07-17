import { createClient } from "redis";

let redis;

if (process.env.REDIS_PROVIDER === "upstash") {
  redis = createClient({
    url: process.env.UPSTASH_REDIS_URL,
    socket: {
      tls: true,
    },
  });
} else {
  redis = createClient({
    url: process.env.REDIS_URL,
  });
}

redis.on("error", (err) => {
  console.error("❌ Redis Error:", err);
});

(async () => {
  try {
    await redis.connect();
    console.log("✅ Redis connected");
  } catch (e) {
    console.error("❌ Redis connection failed:", e);
  }
})();

export default redis;
