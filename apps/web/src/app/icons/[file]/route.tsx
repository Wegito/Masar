import { ImageResponse } from 'next/og';

const SIZES: Record<string, number> = { 'icon-192.png': 192, 'icon-512.png': 512 };

export const dynamic = 'force-static';

export function generateStaticParams(): { file: string }[] {
  return Object.keys(SIZES).map((file) => ({ file }));
}

/**
 * App-Icons, beim Build als PNG erzeugt. Bewusst ohne Schrift: Der Renderer formt arabische
 * Buchstaben nicht korrekt. Motiv: eine Straße mit Haltepunkten (Teilstrecken).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await context.params;
  const size = SIZES[file];
  if (size === undefined) {
    return new Response(null, { status: 404 });
  }
  const unit = size / 16;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1674f2',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: unit }}>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            style={{
              width: unit * 2.4,
              height: unit * 2.4,
              borderRadius: unit * 1.2,
              background: index === 1 ? '#ffffff' : '#b6e2ff',
            }}
          />
        ))}
      </div>
    </div>,
    { width: size, height: size },
  );
}
