import { type Asset, ASSETS } from "../ui/assets.generated.ts";

const INDEX = "/index.html";

function decode(asset: Asset): BodyInit {
  if (asset.encoding === "base64") {
    const binary = atob(asset.body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return asset.body;
}

function toResponse(asset: Asset): Response {
  return new Response(decode(asset), {
    headers: { "content-type": asset.contentType, "cache-control": "no-store" },
  });
}

export function serveAsset(pathname: string): Response | null {
  const asset = ASSETS[pathname];
  if (asset) return toResponse(asset);

  const hasExtension = /\.[a-z0-9]+$/i.test(pathname);
  if (hasExtension) return new Response("Not found", { status: 404 });

  const index = ASSETS[INDEX];
  return index ? toResponse(index) : null;
}
