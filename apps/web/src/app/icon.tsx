import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/** XIRA mark — same gradient and “X” treatment as `XiraLogo`. */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ffffff',
          fontSize: 20,
          fontWeight: 700,
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          background: 'linear-gradient(135deg, #14b8a6 0%, #2f6fed 50%, #1e3a8a 100%)',
        }}
      >
        X
      </div>
    ),
    { ...size },
  );
}
