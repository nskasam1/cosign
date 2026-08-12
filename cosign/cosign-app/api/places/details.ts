export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const placeId = searchParams.get("placeId");
  const fields = searchParams.get("fields") ?? "id,displayName,formattedAddress,location";
  const sessionToken = searchParams.get("sessionToken");

  if (!placeId) {
    return new Response(
      JSON.stringify({ error: { message: "placeId is required" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const apiKey = process.env.GOOGLE_MAPS_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: { message: "GOOGLE_MAPS_KEY not configured" } }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const params = new URLSearchParams({ fields });
  if (sessionToken) params.set("sessionToken", sessionToken);

  const upstream = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}?${params}`,
    { headers: { "X-Goog-Api-Key": apiKey } }
  );

  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
