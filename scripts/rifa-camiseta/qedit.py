#!/usr/bin/env python3
"""Qwen Image Edit 2511 (Lightning 4 steps) over the existing ComfyUI service.
Usage: lds_pollitos.py <input.png> <outdir> <jobs.json>
jobs.json: [{"name": "...", "prompt": "...", "seed": 1}, ...]
"""
import json, sys, time, urllib.request, uuid, os

API = "http://127.0.0.1:8188"
inp, outdir, jobs_path = sys.argv[1], sys.argv[2], sys.argv[3]
jobs = json.load(open(jobs_path))
os.makedirs(outdir, exist_ok=True)

def post_json(path, data):
    req = urllib.request.Request(API + path, data=json.dumps(data).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))

def upload(path):
    boundary = uuid.uuid4().hex
    name = os.path.basename(path)
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\nContent-Type: image/png\r\n\r\n").encode()
    body += open(path, "rb").read() + f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(API + "/upload/image", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    return json.load(urllib.request.urlopen(req))["name"]

def graph(image_name, prompt, seed, prefix, image2=None):
    g = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "qwen_image_edit_2511_bf16.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["1", 0], "lora_name": "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors", "strength_model": 1.0}},
        "3": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["2", 0], "shift": 3.1}},
        "4": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors", "type": "qwen_image", "device": "default"}},
        "5": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
        "6": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "7": {"class_type": "ImageScaleToTotalPixels", "inputs": {"image": ["6", 0], "upscale_method": "lanczos", "megapixels": 1.0, "resolution_steps": 8}},
        "8": {"class_type": "TextEncodeQwenImageEditPlus", "inputs": {"clip": ["4", 0], "prompt": prompt, "vae": ["5", 0], "image1": ["7", 0]}},
        "9": {"class_type": "TextEncodeQwenImageEditPlus", "inputs": {"clip": ["4", 0], "prompt": "", "vae": ["5", 0], "image1": ["7", 0]}},
        "10": {"class_type": "VAEEncode", "inputs": {"pixels": ["7", 0], "vae": ["5", 0]}},
        "11": {"class_type": "KSampler", "inputs": {"model": ["3", 0], "seed": seed, "steps": 4, "cfg": 1.0, "sampler_name": "euler",
               "scheduler": "simple", "positive": ["8", 0], "negative": ["9", 0], "latent_image": ["10", 0], "denoise": 1.0}},
        "12": {"class_type": "VAEDecode", "inputs": {"samples": ["11", 0], "vae": ["5", 0]}},
        "13": {"class_type": "SaveImage", "inputs": {"images": ["12", 0], "filename_prefix": prefix}},
    }
    if image2:
        g["16"] = {"class_type": "LoadImage", "inputs": {"image": image2}}
        g["17"] = {"class_type": "ImageScaleToTotalPixels", "inputs": {"image": ["16", 0], "upscale_method": "lanczos", "megapixels": 1.0, "resolution_steps": 8}}
        g["8"]["inputs"]["image2"] = ["17", 0]
        g["9"]["inputs"]["image2"] = ["17", 0]
    return g

image_name = upload(inp)
for job in jobs:
    img1 = upload(job["image"]) if job.get("image") else image_name
    img2 = upload(job["image2"]) if job.get("image2") else None
    prefix = f"armani-qedit-20261108/{job['name']}"
    pid = post_json("/prompt", {"prompt": graph(img1, job["prompt"], job.get("seed", 7), prefix, img2), "client_id": "armani-qedit"})["prompt_id"]
    t0 = time.time()
    while True:
        time.sleep(2)
        hist = json.load(urllib.request.urlopen(f"{API}/history/{pid}"))
        if pid in hist:
            h = hist[pid]
            st = h.get("status", {})
            if st.get("status_str") == "error":
                print("ERROR", job["name"], json.dumps(st)[:2000]); break
            for node in h["outputs"].values():
                for img in node.get("images", []):
                    q = f"filename={img['filename']}&subfolder={img['subfolder']}&type={img['type']}"
                    data = urllib.request.urlopen(f"{API}/view?{q}").read()
                    dst = os.path.join(outdir, f"{job['name']}.png")
                    open(dst, "wb").write(data)
                    print("OK", job["name"], dst, f"{time.time() - t0:.0f}s", flush=True)
            break
        if time.time() - t0 > 900:
            print("TIMEOUT", job["name"]); break
