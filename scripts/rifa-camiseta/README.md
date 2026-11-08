# Spinning jersey for a raffle (rifa)

These scripts produced the approved spinning goalkeeper jersey signed by Franco Armani
and René Higuita (La Iguaná charity raffle, 2026-11-08, PR #241). Use them to make the
next jersey, for example the white-and-pink Armani one. The approach and the rejected
first version are described in `docs/premios-giratorios.md`.

The files are the exact versions that ran, rebuilt from the session history on
2026-11-08. They still contain Armani-specific values: prompts, crop boxes, signature
regions and the `armani-` prefixes. Change those for each new jersey.

## What you need

- Two real photos of the jersey, front and back (JPG/PNG). Never invent the design.
- The DGX: ComfyUI with Qwen Image Edit 2511 + Lightning, run through `gpu-run`,
  and the Blender 5.1 wrapper `~/blender-agent-20261004/bin/blender-run`.
- Locally: Python with numpy, scipy, scikit-image and Pillow. On the DGX: ffmpeg
  (`build_assets.py`).

## Steps

1. **Catalog shots (DGX, ComfyUI).** Copy `qedit.py`, the job lists and the photos
   (as PNG) to a job folder, then run:
   `gpu-run "<name>" -- python3 qedit.py front.png out jobs-front.json`. Do the same
   with `back.png` and `jobs-back.json`. About 16 s per image.
   - The prompts describe the jersey design in detail (colors, sponsors, crest,
     collar, signatures). Rewrite that description for the new jersey.
   - Pick the best front, then run `jobs2.json`. It removes the mannequin from the
     chosen front (`ghost44-*`, input `out/front-sig-44.png`) and gives clean backs
     (`backm-*`).
   - For Armani the picks were `ghost44-3.png` (front) and `backm-1.png` (back).
   - The output subfolder is hard-coded in `qedit.py` (`armani-qedit-20261108`).
2. **Textures and volume (local).** Run
   `python prep2.py <front.png> <back.png> . 160 4.1 0.35`. It writes `front_tex.png`,
   `back_tex.png`, `geo.npz` and `meta.json`.
   - The back is mirrored and registered to the front silhouette.
   - The body and sleeves are a Poisson-inflated height field.
   - The arguments are: armpit cut length, depth `K`, roundness `EXP`.
   - Check `_overlay.png` and `_height.png`.
3. **Side swatch.** Edit the crop box in `swatch.py`: a piece of the plain pattern
   from the lower back, without logos. Run it to get `swatch.png`. The sides of the
   mesh use this pattern so the photo is not smeared.
4. **Signatures (only if signed).** Adjust the color thresholds and the chest region
   in `ink_mask.py`, then run it (`ink.npy`). `bold_signatures.py` redraws the ink in
   thicker gold (`front_tex_bold.png`) so it reads at turntable size.
5. **Render (DGX).** Upload `geo.npz`, `front_tex.png`, `back_tex.png`, `swatch.png`,
   `turntable2.py`, `build_assets.py` and `meta.json` to a data folder, then run
   `BLENDER_BACKEND=CUDA BLENDER_TIMEOUT=2200 ~/blender-agent-20261004/bin/blender-run <job-dir> <data>/turntable2.py <data> all 1024 0.5 64`.
   - This renders 144 poses (2.5° apart), 1024 px, 64 samples.
   - Test first with a few poses, for example `6,24`.
   - If the GPU runs out of memory, render the 144 poses in two batches by passing
     comma-separated frame lists. Merge the frames into one folder.
   - For the bold signatures, use a second data folder whose `front_tex.png` is
     `front_tex_bold.png`. Re-render the front-facing poses (0–48 and 108–143) and
     copy them over the merged frames.
6. **Atlases (DGX).** Run `python3 build_assets.py <frames-dir> <assets-dir> <prefix>`
   (Armani used `armani-v2`). It writes 192/512 px atlases, front/back/poster stills,
   the animated WebP/WebM fallbacks and `_contact.png` for review.
7. **Install.** Run `python install_assets.py <assets-dir> <repo> <dir-with-real-photos>`.
   It copies everything into `public/prizes/armani-<sha12>/`, a folder versioned by
   content: never change bytes in place. The `armani` prefixes in it are per jersey.
8. **Story images.** `story_shirt2.py <front.png> armani-frente.png` gives the 356×420
   cut-out. `story_shirt_hd.py` gives the full-size one; resize it to 600 px wide for
   `armani-frente-hd.png`. Both go in `assets/rifas-story/premios/`.
9. **Wire it.** Add the raffle uuid and its jersey media to `lib/rifas/benefit.ts`
   (see `armaniJersey`), plus its story art (`rifaStoryArt`). Add the slug to
   `lib/rifas/partner.ts` if it is a Los Del Sur raffle, and update
   `tests/rifas-benefit.test.ts`.

## Cleanup

The render folders on the DGX are about 600 MB per jersey. `dgx-exec run` refuses
`rm -r`, so ask the owner to delete them when the raffle is live, or render inside a
registered DGX storage job so its cleaner removes them.
