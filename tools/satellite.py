# Derives map-space layers from references/kastenhof-satelite.png.
#
#   uv run --with numpy --with pillow --with scipy python tools/satellite.py
#
# Outputs (all in the 2000x1240 map-pixel space used by js/network/traces.js):
#   references/satellite-map.webp  satellite warped onto the map, cropped to SAT_BOUNDS
#   references/landcover.png      1 px = 2 map px. R = forest, G = coverage, B = ground brightness
#
# SAT_H maps satellite pixels to map pixels. It was fitted to seven shared
# features (the roundabout island, the bridges, the junction centres and the
# P marker), with about 5 m of residual error. Keep it in sync with
# CONFIG.satellite in js/config.js.
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = __file__.rsplit('/tools/', 1)[0]
SAT_H = np.array([
    [0.25240243776272114, 0.026816847006081255, 575.4991323029958],
    [-0.02243097159996962, 0.317134996283958, 354.7546022001005],
    [-4.020568161751692e-05, 7.771459425306122e-06, 1.0],
])
SAT_BOUNDS = (570, 325, 1440, 850)  # map px: x0, y0, x1, y1
MAP_W, MAP_H = 2000, 1240


def warp(img_arr, H_inv, x0, y0, w, h, scale):
    """Sample img_arr (sat space) on a map-space grid starting at (x0, y0)."""
    ys, xs = np.mgrid[0:h, 0:w]
    mx = x0 + (xs + 0.5) / scale
    my = y0 + (ys + 0.5) / scale
    p = np.stack([mx, my, np.ones_like(mx)], -1) @ H_inv.T
    sx, sy = p[..., 0] / p[..., 2], p[..., 1] / p[..., 2]
    inside = (sx >= 0) & (sy >= 0) & (sx < img_arr.shape[1] - 1) & (sy < img_arr.shape[0] - 1)
    sx = np.clip(sx, 0, img_arr.shape[1] - 1.001)
    sy = np.clip(sy, 0, img_arr.shape[0] - 1.001)
    if img_arr.ndim == 2:
        out = ndimage.map_coordinates(img_arr, [sy, sx], order=1)
    else:
        out = np.stack([ndimage.map_coordinates(img_arr[..., c], [sy, sx], order=1) for c in range(img_arr.shape[2])], -1)
    return out, inside


def main():
    sat = np.asarray(Image.open(f'{ROOT}/references/kastenhof-satelite.png').convert('RGB')).astype(np.float32)
    Hi = np.linalg.inv(SAT_H)

    # Reference overlay: satellite in map space at 2x map resolution.
    x0, y0, x1, y1 = SAT_BOUNDS
    rgb, inside = warp(sat, Hi, x0, y0, (x1 - x0) * 2, (y1 - y0) * 2, 2)
    alpha = (inside * 255).astype(np.uint8)
    rgba = np.dstack([rgb.clip(0, 255).astype(np.uint8), alpha])
    Image.fromarray(rgba, 'RGBA').save(f'{ROOT}/references/satellite-map.webp', quality=86)

    # Land cover in sat space. Asphalt is bluish grey; forest is dark and
    # textured (crowns and their shadows); meadows are brighter and smooth.
    r, g, b = sat[..., 0], sat[..., 1], sat[..., 2]
    lum = sat.mean(2)
    road = ((b - g) > 10) & ((b - r) > 4) & (lum > 80) | ((lum > 175) & (abs(r - g) < 20) & (abs(g - b) < 25))
    road = ndimage.binary_closing(ndimage.median_filter(road, 7), iterations=2)
    lum_b = ndimage.gaussian_filter(lum, 10)
    tex = np.sqrt(np.maximum(ndimage.gaussian_filter(lum * lum, 8) - ndimage.gaussian_filter(lum, 8) ** 2, 0))
    forest = (lum_b < 76) & ((tex > 14) | (lum_b < 62)) & ~ndimage.binary_dilation(road, iterations=10)
    forest = ndimage.gaussian_filter(forest.astype(np.float32), 6)
    bright = ndimage.gaussian_filter(np.clip((lum - 55) / 70, 0, 1), 10)

    # Resample to map space (1 px = 2 map px = 1 m), feather the coverage edge.
    w, h = MAP_W // 2, MAP_H // 2
    f_map, inside = warp(forest, Hi, 0, 0, w, h, 0.5)
    b_map, _ = warp(bright, Hi, 0, 0, w, h, 0.5)
    cov = ndimage.distance_transform_edt(inside)
    cov = np.clip(cov / 25.0, 0, 1)
    out = np.stack([f_map * 255, cov * 255, b_map * 255], -1)
    out[~inside] = 0
    Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(f'{ROOT}/references/landcover.png')
    print('wrote satellite-map.webp and landcover.png')


if __name__ == '__main__':
    main()
