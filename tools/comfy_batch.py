"""
Queue a batch of Qwen image + Chatterbox TTS prompts through ComfyUI's API,
wait for each to finish, and save outputs into Clarity/assets/.

Usage:
  python comfy_batch.py           # run all
  python comfy_batch.py images    # images only
  python comfy_batch.py tts       # TTS only
  python comfy_batch.py test      # one image + one TTS, for pipeline verification
"""
import json, os, sys, time, urllib.request, urllib.error, uuid, shutil, glob

SERVER = "http://127.0.0.1:8000"
CLIENT_ID = str(uuid.uuid4())

# Where the ComfyUI outputs land (from system_stats argv)
COMFY_OUTPUT = r"C:\Users\thefi\Documents\ComfyUI\output"

# Destination inside the game
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DEST  = os.path.join(REPO_ROOT, "assets", "images")
AUDIO_DEST = os.path.join(REPO_ROOT, "assets", "audio")
os.makedirs(IMG_DEST, exist_ok=True)
os.makedirs(AUDIO_DEST, exist_ok=True)

# ---------- Workflow builders ----------
def qwen_image_workflow(positive, width, height, filename_prefix, seed=None):
    """
    Qwen-Image 2512 FP8 + Wuli Turbo 2-step LoRA text-to-image.
    Matches the canonical workflow: UNET -> LoRA(turbo) -> ModelSamplingAuraFlow(shift=3)
    -> CLIPTextEncode -> ConditioningZeroOut (for negative) -> EmptySD3LatentImage
    -> KSampler(steps=2, cfg=1.0, euler, simple, denoise=1.0) -> VAEDecode -> SaveImage.
    """
    s = seed if seed is not None else int.from_bytes(os.urandom(4), "big")
    return {
        # Step 1 - Load Models
        "unet": {"class_type": "UNETLoader", "inputs": {
            "unet_name": "qwen_image_2512_fp8_e4m3fn.safetensors",
            "weight_dtype": "default"
        }},
        "lora": {"class_type": "LoraLoaderModelOnly", "inputs": {
            "model": ["unet", 0],
            "lora_name": "Wuli-Qwen-Image-2512-Turbo-LoRA-2steps-V1.0-bf16.safetensors",
            "strength_model": 1.0
        }},
        "sampling": {"class_type": "ModelSamplingAuraFlow", "inputs": {
            "model": ["lora", 0],
            "shift": 3.0
        }},
        "clip": {"class_type": "CLIPLoader", "inputs": {
            "clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
            "type": "qwen_image",
            "device": "default"
        }},
        "vae": {"class_type": "VAELoader", "inputs": {
            "vae_name": "qwen_image_vae.safetensors"
        }},
        # Step 3 - Prompt
        "positive": {"class_type": "CLIPTextEncode", "inputs": {
            "clip": ["clip", 0],
            "text": positive
        }},
        "negative": {"class_type": "ConditioningZeroOut", "inputs": {
            "conditioning": ["positive", 0]
        }},
        # Step 2 - Image size
        "latent": {"class_type": "EmptySD3LatentImage", "inputs": {
            "width": width,
            "height": height,
            "batch_size": 1
        }},
        # Sample
        "ksampler": {"class_type": "KSampler", "inputs": {
            "model": ["sampling", 0],
            "seed": s,
            "steps": 2,
            "cfg": 1.0,
            "sampler_name": "euler",
            "scheduler": "simple",
            "positive": ["positive", 0],
            "negative": ["negative", 0],
            "latent_image": ["latent", 0],
            "denoise": 1.0
        }},
        "decode": {"class_type": "VAEDecode", "inputs": {
            "samples": ["ksampler", 0],
            "vae": ["vae", 0]
        }},
        "save": {"class_type": "SaveImage", "inputs": {
            "images": ["decode", 0],
            "filename_prefix": filename_prefix
        }}
    }

def chatterbox_workflow(text, filename_prefix, seed=0, exaggeration=0.5, temperature=0.8, cfg_weight=0.5):
    return {
        "1": {"class_type": "ChatterboxTTS", "inputs": {
            "model_pack_name": "resembleai_default_voice",
            "text": text,
            "max_new_tokens": 1000,
            "flow_cfg_scale": 0.7,
            "exaggeration": exaggeration,
            "temperature": temperature,
            "cfg_weight": cfg_weight,
            "repetition_penalty": 1.2,
            "min_p": 0.05,
            "top_p": 1.0,
            "seed": seed,
            "use_watermark": False
        }},
        "2": {"class_type": "SaveAudioMP3", "inputs": {
            "audio": ["1", 0],
            "filename_prefix": filename_prefix,
            "quality": "V0"
        }}
    }

# ---------- Job manifest ----------
NEG = "text, watermark, signature, lowres, blurry, jpeg artifacts, deformed, extra limbs, extra fingers, malformed, ugly, oversaturated, amateur"

IMAGE_JOBS = [
    # Kael is a portrait — use 3:4 aspect (1104x1472)
    {
        "name": "kael",
        "save_as": "kael.png",
        "prompt": "a charismatic middle-aged cyberpunk preacher named Prophet Kael in a candlelit cathedral, piercing eyes, long grey coat, subtle metallic chrome seam visible beneath the skin above his ear, warm candles lighting his face from below, hands raised in sermon, cinematic, neon reflections faint in the background, photorealistic, dramatic chiaroscuro lighting, film grain, anamorphic",
        "width": 1104, "height": 1472
    },
    # Lattice is a floating face — 16:9 widescreen (1664x928)
    {
        "name": "lattice",
        "save_as": "lattice_ai.png",
        "prompt": "benevolent AI visualization named Lattice, floating abstract humanoid face made of soft flowing data-light, translucent iridescent, gentle smile, cyan and magenta neon glow, particles drifting, dark void background, calm and moral and compassionate aesthetic, cinematic, ethereal, high detail, 8k",
        "width": 1664, "height": 928
    },
    # Archive background — 16:9 widescreen (1664x928)
    {
        "name": "archive_bg",
        "save_as": "archive_bg.png",
        "prompt": "endless rows of analog reel-to-reel tape machines and glowing CRT monitors stretching to the vanishing point, candles on the floor between them, hooded archivists in the middle distance cataloging memories, dust motes in warm amber light, cyberpunk shadow-library vibe, cinematic wide shot, photorealistic, volumetric light, deep perspective, film grain",
        "width": 1664, "height": 928
    },
    # Merged ending — 16:9 widescreen
    {
        "name": "ending_merged",
        "save_as": "ending_merged.png",
        "prompt": "nine shadowy corporate figures seated in a circle at a chrome table becoming ten as a tenth figure dissolves into white-gold light and joins them, all faceless, dense corporate boardroom of black glass, cinematic, overhead godlight, hive-mind merging aesthetic, surreal, photorealistic, apocalyptic awe, quiet horror",
        "width": 1664, "height": 928
    },
    # Erased ending — 16:9 widescreen
    {
        "name": "ending_erased",
        "save_as": "ending_erased.png",
        "prompt": "a nameless hooded figure sitting alone on a wet neon-lit bench in a rainy Gutter-9 back alley at dawn, head down, holding a paper cup of synth-noodles, neon signs reflected in puddles around them, melancholy peace, soft blue-magenta light, cinematic, photorealistic, anamorphic wide shot, film grain",
        "width": 1664, "height": 928
    },
    # Compliance vault — 16:9 widescreen
    {
        "name": "compliance_vault",
        "save_as": "compliance_vault.png",
        "prompt": "a vast sterile cyberpunk server room full of floor-to-ceiling glass cylinders each containing a single softly glowing memory orb, cool blue-white light, polished black marble floor, two grey-suited Compliance Auditors in the foreground walking away from camera, clinical and menacing, cinematic wide shot, photorealistic, volumetric light, 8k, anamorphic",
        "width": 1664, "height": 928
    },
]

# ---------- Intro-cinematic-only jobs ----------
INTRO_IMAGE_JOBS = [
    {
        "name": "intro_safehouse",
        "save_as": "intro_safehouse.jpg",
        "prompt": "cramped cyberpunk safehouse interior in Gutter-9, dim warm orange lamp on a desk with a cyberdeck covered in blinking red LEDs, rain streaking the single window, neon signs outside reflecting on the wet glass, tangle of cables on the floor, corrugated metal walls, empty room no people, photorealistic, cinematic wide shot, moody, melancholy, film grain",
        "width": 1664, "height": 928
    },
    {
        "name": "intro_deck_pov",
        "save_as": "intro_deck_pov.jpg",
        "prompt": "first-person POV of hands on a cyberpunk data-deck keyboard at night, holographic green terminal display glowing, rain-streaked window behind, pink and cyan neon signs reflecting on the wet glass, moody low light, cinematic, photorealistic, shallow depth of field, focus on hands and keys, film grain",
        "width": 1664, "height": 928
    },
    {
        "name": "intro_gutter9",
        "save_as": "intro_gutter9.jpg",
        "prompt": "wet narrow alley in a dystopian cyberpunk gutter-level slum at 3am, neon signs in Japanese and English, hooded figures in the distance, puddles reflecting magenta and cyan light, steam rising from vents, trash, handwritten graffiti, cinematic wide shot, photorealistic, rain heavy, Blade Runner, moody, film grain, anamorphic lens",
        "width": 1664, "height": 928
    },
]

INTRO_TTS_JOBS = [
    # Slow, grave narrator voice — lower exaggeration, slower temperature, deep-ish
    {
        "name": "intro_1_rain",
        "save_as": "intro_1_rain.mp3",
        "text": "The rain hasn't stopped in seven years.",
        "exaggeration": 0.4, "temperature": 0.6, "cfg_weight": 0.5, "seed": 1001
    },
    {
        "name": "intro_2_omni",
        "save_as": "intro_2_omni.mp3",
        "text": "Omni-Corp owns the sky. Their neural implants promised to end cyber-psychosis. They lied. The implants are a backdoor. A plan to merge every mind in Neon City into a single, manageable consciousness. They call it... The Project.",
        "exaggeration": 0.45, "temperature": 0.65, "cfg_weight": 0.5, "seed": 1002
    },
    {
        "name": "intro_3_factions",
        "save_as": "intro_3_factions.mp3",
        "text": "The streets fight back. The Shadow archives what Compliance erases. The Mnemonic Collective traffics in stolen memories. Purity rejects the chrome. The Chrome-Jaws sell it by the pound.",
        "exaggeration": 0.4, "temperature": 0.6, "cfg_weight": 0.5, "seed": 1003
    },
    {
        "name": "intro_4_lattice",
        "save_as": "intro_4_lattice.mp3",
        "text": "Lattice, the AI who brokers everything between them, has started refusing deals that end in deaths.",
        "exaggeration": 0.35, "temperature": 0.55, "cfg_weight": 0.5, "seed": 1004
    },
    {
        "name": "intro_5_wake",
        "save_as": "intro_5_wake.mp3",
        "text": "You wake in a safehouse in Gutter-9. Your deck is humming. You have one memory left that feels like it's yours.",
        "exaggeration": 0.4, "temperature": 0.6, "cfg_weight": 0.5, "seed": 1005
    },
    {
        "name": "intro_6_stakes",
        "save_as": "intro_6_stakes.mp3",
        "text": "This week you will decide which of them gets the rest.",
        "exaggeration": 0.45, "temperature": 0.6, "cfg_weight": 0.5, "seed": 1006
    },
    {
        "name": "intro_7_welcome",
        "save_as": "intro_7_welcome.mp3",
        "text": "Welcome to Neon City.",
        "exaggeration": 0.5, "temperature": 0.7, "cfg_weight": 0.5, "seed": 1007
    },
]

TTS_JOBS = [
    {
        "name": "reso_overlay",
        "save_as": "tts_reso_overlay.mp3",
        "text": "Wake up, Neon City. They're selling your Tuesdays back to you at a markup.",
        "exaggeration": 0.7, "temperature": 0.9, "cfg_weight": 0.5, "seed": 101
    },
    {
        "name": "duchess_rend",
        "save_as": "tts_duchess_rend.mp3",
        "text": "You've been selling our ghosts to the Mnemonic Collective. I have questions. They have edges.",
        "exaggeration": 0.3, "temperature": 0.75, "cfg_weight": 0.4, "seed": 202
    },
    {
        "name": "lattice",
        "save_as": "tts_lattice.mp3",
        "text": "I won't give you more today. I know what you'd do with it.",
        "exaggeration": 0.3, "temperature": 0.65, "cfg_weight": 0.5, "seed": 303
    },
    {
        "name": "auditor",
        "save_as": "tts_auditor.mp3",
        "text": "A routine wellness check, citizen. Would you prefer audio or visual scan?",
        "exaggeration": 0.25, "temperature": 0.6, "cfg_weight": 0.5, "seed": 404
    },
    {
        "name": "kael",
        "save_as": "tts_kael.mp3",
        "text": "The body is sacred. The chrome is not. Come to me clean, or do not come at all.",
        "exaggeration": 0.6, "temperature": 0.85, "cfg_weight": 0.5, "seed": 505
    },
    {
        "name": "archive_end",
        "save_as": "tts_archive_end.mp3",
        "text": "End. The city remembers.",
        "exaggeration": 0.3, "temperature": 0.7, "cfg_weight": 0.5, "seed": 606
    },
]

# ---------- API helpers ----------
def api(path, method="GET", body=None):
    url = SERVER + path
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))

def queue_prompt(workflow):
    return api("/prompt", "POST", {"prompt": workflow, "client_id": CLIENT_ID})

def wait_for(prompt_id, timeout=600, poll=1.5):
    start = time.time()
    while time.time() - start < timeout:
        try:
            hist = api(f"/history/{prompt_id}")
            if hist and prompt_id in hist:
                return hist[prompt_id]
        except Exception:
            pass
        time.sleep(poll)
    raise TimeoutError(f"Timed out waiting for prompt {prompt_id}")

def find_output_files(entry):
    """From a history entry, yield output file paths on disk."""
    outputs = entry.get("outputs", {})
    for node_id, node_out in outputs.items():
        for key in ("images", "audio", "gifs"):
            for item in node_out.get(key, []):
                fn = item.get("filename")
                sf = item.get("subfolder", "")
                if not fn: continue
                full = os.path.join(COMFY_OUTPUT, sf, fn)
                yield full, key

# ---------- Dispatch ----------
def run_jobs(jobs, build_workflow, default_ext, dest_dir):
    for job in jobs:
        name = job["name"]
        print(f"\n=== {name} ===")
        wf = build_workflow(job)
        r = queue_prompt(wf)
        pid = r.get("prompt_id") or r.get("promptId")
        print(f"  queued prompt_id={pid}")
        entry = wait_for(pid)
        outputs = list(find_output_files(entry))
        for idx, (path, kind) in enumerate(outputs):
            if not os.path.exists(path):
                print(f"  [!] missing output file: {path}")
                continue
            ext = os.path.splitext(path)[1].lower() or default_ext
            base, _ = os.path.splitext(job["save_as"])
            if idx == 0:
                fname = base + ext
            else:
                fname = f"{base}_alt{idx}{ext}"
            dst = os.path.join(dest_dir, fname)
            shutil.copyfile(path, dst)
            print(f"  saved -> {os.path.relpath(dst, REPO_ROOT)}")

def build_image_wf(job):
    return qwen_image_workflow(
        positive=job["prompt"],
        width=job["width"], height=job["height"],
        filename_prefix=f"clarity_{job['name']}"
    )

def build_tts_wf(job):
    return chatterbox_workflow(
        text=job["text"],
        filename_prefix=f"clarity_tts_{job['name']}",
        seed=job["seed"],
        exaggeration=job["exaggeration"],
        temperature=job["temperature"],
        cfg_weight=job["cfg_weight"]
    )

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode in ("all", "images"):
        run_jobs(IMAGE_JOBS, build_image_wf, ".png", IMG_DEST)
    if mode in ("all", "tts"):
        run_jobs(TTS_JOBS,   build_tts_wf,   ".mp3", AUDIO_DEST)
    if mode == "tts-remaining":
        names = sys.argv[2].split(",") if len(sys.argv) > 2 else ["lattice","auditor","kael","archive_end"]
        remaining = [j for j in TTS_JOBS if j["name"] in names]
        run_jobs(remaining, build_tts_wf, ".mp3", AUDIO_DEST)
    if mode == "test":
        run_jobs(IMAGE_JOBS[:1], build_image_wf, ".png", IMG_DEST)
        run_jobs(TTS_JOBS[:1],   build_tts_wf,   ".mp3", AUDIO_DEST)
    if mode == "intro":
        run_jobs(INTRO_IMAGE_JOBS, build_image_wf, ".png", IMG_DEST)
        run_jobs(INTRO_TTS_JOBS,   build_tts_wf,   ".mp3", AUDIO_DEST)
    if mode == "intro-images":
        run_jobs(INTRO_IMAGE_JOBS, build_image_wf, ".png", IMG_DEST)
    if mode == "intro-tts":
        run_jobs(INTRO_TTS_JOBS,   build_tts_wf,   ".mp3", AUDIO_DEST)
    print("\nDone.")

if __name__ == "__main__":
    main()
