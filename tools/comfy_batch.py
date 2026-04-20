"""
Queue a batch of Qwen image + Chatterbox TTS prompts through ComfyUI's API,
wait for each to finish, and save outputs into Clarity/assets/.

Usage:
  python comfy_batch.py                      # run all
  python comfy_batch.py images               # images only
  python comfy_batch.py tts                  # TTS only
  python comfy_batch.py test                 # one image + one TTS, for pipeline verification
  python comfy_batch.py memories             # 30 polaroid memory images (25 hooks + 5 fallbacks)
  python comfy_batch.py memories-test        # one memory image, for pipeline verification
  python comfy_batch.py memories-one <name>  # single named memory (e.g. mem_joy_1)
"""
import json, os, sys, time, urllib.request, urllib.error, uuid, shutil, glob

SERVER = "http://127.0.0.1:8000"
CLIENT_ID = str(uuid.uuid4())

# Where the ComfyUI outputs land (from system_stats argv)
COMFY_OUTPUT = r"C:\Users\thefi\Documents\ComfyUI\output"

# Destination inside the game
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DEST  = os.path.join(REPO_ROOT, "assets", "images")
MEM_DEST  = os.path.join(IMG_DEST, "memories")
AUDIO_DEST = os.path.join(REPO_ROOT, "assets", "audio")
os.makedirs(IMG_DEST, exist_ok=True)
os.makedirs(MEM_DEST, exist_ok=True)
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
# ---------- Memory polaroids (25 seed hooks + 5 emotion fallbacks) ----------
# Square 1328x1328 is the native 1:1 resolution for the Qwen-Image 2512
# Turbo LoRA — lower sizes soften detail. The prompts are structured so the
# model gets: setting -> subject with specific physical anchors -> action/
# emotion beat -> atmosphere/secondary detail -> unifying photographic style
# block. Every render is an aged instant-camera polaroid: analog, grainy,
# slightly overexposed, warmly faded, cinematic cyberpunk realism — NOT
# illustration, NOT anime. The MEM_STYLE suffix locks this in per job.
MEM_SIZE = (1328, 1328)
MEM_STYLE = (
    "Shot as a candid amateur polaroid on expired instant-camera film, "
    "square 1:1 format, fine natural film grain, subtle color shift typical "
    "of aged instant film, warm highlight fade, soft vignette, slight "
    "over-exposure on the brightest light source, shallow depth of field, "
    "imperfect natural framing. Photorealistic live-action cyberpunk — NOT "
    "illustration, NOT anime, NOT 3d render, NOT painting. Atmospheric "
    "depth, dramatic cinematic lighting, high micro-detail on faces / "
    "fabrics / metal, analog photographic texture, Blade Runner palette, "
    "Denis Villeneuve composition sensibility. No text, no watermark, no "
    "signature, no border elements inside the image."
)

MEMORY_IMAGE_JOBS = [
    # ---------------- JOY ----------------
    {"name": "mem_joy_1", "save_as": "memory_joy_1.png",
     "prompt": (
         "A neon sunrise seen from a rust-streaked slum rooftop at dawn in a "
         "cyberpunk megacity: distant arcology megastructures silhouetted "
         "against a sky bleeding from deep magenta through peach into pale "
         "cyan, their topmost antennae still winking with decaying "
         "advertisement neon, a thin sliver of a real sun cresting between "
         "two spires, its warm horizontal light flooding a wet tar rooftop "
         "in the foreground. Puddles catch pink and gold reflections, a "
         "knocked-over radio antenna lies at the edge of frame, a single "
         "crow silhouetted on a pipe. No human figures. The private, "
         "hopeful hush of a city caught just before it wakes. Wide low "
         "horizontal composition. " + MEM_STYLE
     )},
    {"name": "mem_joy_2", "save_as": "memory_joy_2.png",
     "prompt": (
         "Close candid portrait inside a cramped cyberpunk karaoke booth: a "
         "stranger in their mid-20s caught mid-laugh, head tilted back, eyes "
         "squeezed shut in genuine unguarded joy, undercut hair dyed "
         "translucent teal, a tiny silver ring through the septum catching "
         "the light, a faint data-tattoo peeking above a black band t-shirt "
         "collar. A microphone loose in one hand, the other thrown up "
         "gesturing. Magenta and teal neon from the karaoke screen wash "
         "unevenly across the face, the screen behind them blurred with "
         "kanji lyrics. Bead curtain streaks the left edge. Chest-up "
         "framing, imperfect focus caught on the nearest eyelash. "
         + MEM_STYLE
     )},
    {"name": "mem_joy_3", "save_as": "memory_joy_3.png",
     "prompt": (
         "A pair of weathered gloved hands cradling a paper bowl of steaming "
         "synth-noodles on the rusted railing of a cyberpunk rooftop at "
         "night: thick black chopsticks mid-lift with a tangle of glossy "
         "noodles, visible steam curling upward, cold breath fogging in "
         "front of the bowl, a bandage wrapping one knuckle. The vast city "
         "below blurs into streaks of pink and cyan neon, a single red "
         "aircraft beacon blinks on the horizon, a drone flashes past "
         "out-of-focus. Close low-angle POV over the bowl, narrow depth of "
         "field, condensation beading on the thermal glove. Small human "
         "warmth against an enormous indifferent city. " + MEM_STYLE
     )},
    {"name": "mem_joy_4", "save_as": "memory_joy_4.png",
     "prompt": (
         "First-person overhead view of two hands meeting above the open "
         "data port of a battered cyberdeck on a cluttered workbench: one "
         "hand organic with stained fingertips and a faded stick-and-poke "
         "tattoo on the wrist, the other lightly chromed with glowing cyan "
         "knuckle seams and articulated finger joints, thumbs clasped in a "
         "clean hacker handshake, a single clean arc of blue-white data-"
         "light jumping between the palms. Circuit board glowing below, "
         "tiny dust motes suspended in the light, a dim warm workbench lamp "
         "mixing with the cold blue grid-glow. The triumphant instant of "
         "first clean uplink. Intimate overhead close framing. " + MEM_STYLE
     )},
    {"name": "mem_joy_5", "save_as": "memory_joy_5.png",
     "prompt": (
         "Cramped cyberpunk apartment interior at night: a five-year-old "
         "child in pyjamas leaning over a translucent holographic birthday "
         "cake projected from a cheap desktop emitter on a chipped formica "
         "table, cyan and pink holo-candles flickering on their awed upturned "
         "face, tiny real fingers reaching toward the projection but passing "
         "clean through it. A hand-painted paper banner sags above the "
         "fridge, wallpaper peels in one corner, a single cracked window "
         "shows distant neon signs through rain streaks. Shallow depth of "
         "field on the child's face, waist-height POV from across the "
         "table, domestic warmth, quiet wonder. " + MEM_STYLE
     )},

    # ---------------- FEAR ----------------
    {"name": "mem_fear_1", "save_as": "memory_fear_1.png",
     "prompt": (
         "A wet cyberpunk back alley at 3 AM drowning in thick magenta "
         "neon fog: two unblinking red sensor eyes glowing low in the haze, "
         "the silhouette of a quadrupedal synth-hound barely resolving "
         "behind them — long pitted jaw, raised hackles of exposed metal "
         "vertebrae along the spine, clawed feet planted on slick wet "
         "asphalt, faint steam drifting from flank vents. A discarded "
         "ramen cup lies between its paws. Deep vignette, low ground-level "
         "POV, razor-shallow depth of field pulling focus onto the eyes, "
         "the rest of the body bleeding into the fog. The predatory "
         "stillness of the instant before it decides to move. " + MEM_STYLE
     )},
    {"name": "mem_fear_2", "save_as": "memory_fear_2.png",
     "prompt": (
         "First-person POV over a cyberdeck keyboard in the exact moment of "
         "catastrophic failure: the terminal screen collapsing from a full "
         "cascade of green code down to a single fading pixel of light at "
         "the dead center, the distorted reflection of the operator's "
         "panicked face visible in the darkening glass, rain streaking the "
         "window behind the monitor, an unplugged cable smoking faintly on "
         "the desk, a red status LED already dead. Trembling fingertips "
         "intrude at the bottom of the frame. Dim warm desk lamp "
         "overwhelmed by the blackout. Shallow depth of field on the last "
         "pixel. Digital death, witnessed. " + MEM_STYLE
     )},
    {"name": "mem_fear_3", "save_as": "memory_fear_3.png",
     "prompt": (
         "Extreme low-angle POV looking straight up a dim concrete "
         "cyberpunk stairwell at a descending line of black Compliance "
         "Auditor jackboots two flights above: polished boot tips, grey "
         "fatigue hems, long shadows thrown down the steps, a single red "
         "emergency light strip running along the handrail bleeding crimson "
         "over the wall and the ceiling, peeling government compliance "
         "notices taped to the stairwell, a discarded paper cup on one "
         "landing. Claustrophobic forced-perspective composition, narrow "
         "depth of field, cold fluorescent blue-white fighting the hot red "
         "emergency wash. Institutional dread. " + MEM_STYLE
     )},
    {"name": "mem_fear_4", "save_as": "memory_fear_4.png",
     "prompt": (
         "Extreme macro close-up of a permanent chrome cyberpunk smile: "
         "polished titanium teeth fused locked open, the lips split wide "
         "and scarred at the corners where they can no longer close, a "
         "fine hairline surgical scar along the upper gumline, tiny "
         "reflections of pink and green street neon dancing across the "
         "metal, a single thread of saliva catching the frontal light, the "
         "rest of the face out of focus behind. Macro lens compression, "
         "razor-shallow depth of field on the enamel of the front teeth, "
         "direct flash-like frontal illumination. Unsettling intimate "
         "horror. " + MEM_STYLE
     )},
    {"name": "mem_fear_5", "save_as": "memory_fear_5.png",
     "prompt": (
         "A scarred gloved cyberpunk hand gripping the emitter of a "
         "monowire vibroblade in a dark rain-wet alley: the filament itself "
         "a line of cyan-white heat, visible distortion shimmer and thin "
         "sparks drifting off the wire, wet concrete below catching the "
         "glow, a pattern of cracked asphalt, distant blurred pink neon "
         "signage in the background, blood not yet drawn. Close low-angle "
         "framing tight on the weapon, shallow depth of field, strong "
         "chiaroscuro contrast, deep vignette. The humming kinetic menace "
         "of the instant before violence. " + MEM_STYLE
     )},

    # ---------------- RAGE ----------------
    {"name": "mem_rage_1", "save_as": "memory_rage_1.png",
     "prompt": (
         "Interior of a gutted cyberpunk street clinic in the slum of "
         "Gutter-9 the morning after a Compliance raid: overturned steel "
         "examination tables, smashed diagnostic monitors still faintly "
         "sparking, scattered glass ampoules of medication across the "
         "checker-tile floor, a single IV stand standing impossibly upright "
         "amid the wreckage with its drip line still swinging, smoke "
         "curling from a blown breaker box, a child's crayon drawing "
         "pinned to the wall now spattered with dirty water, bitter orange "
         "emergency light from one surviving overhead lamp. No figures. "
         "Wide waist-height establishing composition, heavy atmospheric "
         "dust, shallow depth of field pulling focus onto the lone IV "
         "stand. The aftermath of institutional violence. " + MEM_STYLE
     )},
    {"name": "mem_rage_2", "save_as": "memory_rage_2.png",
     "prompt": (
         "First-person POV at dawn in a narrow cyberpunk apartment hallway: "
         "a black Corp-Sec combat boot mid-kick frozen in the instant of "
         "shattering a thin peeling apartment door, wood splinters "
         "suspended in the air, a red eviction notice pinned to the door "
         "half torn from the impact, red emergency light spilling through "
         "the widening gap, a child's tiny pair of worn sneakers in the "
         "corner of the doorframe, a crack in the hallway plaster running "
         "up to the ceiling. Low-angle close framing, subtle motion blur "
         "on the boot, deep vignette, cold fluorescent hallway light "
         "mixing with the hot red from inside. Helpless fury. " + MEM_STYLE
     )},
    {"name": "mem_rage_3", "save_as": "memory_rage_3.png",
     "prompt": (
         "Extreme macro close-up of a single human eye caught in the "
         "instant of remote neural override: the pupil dilating unnaturally "
         "wide then going flat and mirrored, the iris losing its colour "
         "saturation, faint fractal circuit lines blooming through the "
         "whites of the eye, the last dying neon reflection fading out of "
         "the cornea, a single damp eyelash, out-of-focus strand of hair "
         "crossing the top of the frame. Razor-shallow depth of field "
         "hitting exactly on the iris, cold blue fill light on the side of "
         "the nose, a faint warm rim from an unseen lamp. The moment a "
         "friend stops being a person and becomes a remote terminal. "
         + MEM_STYLE
     )},
    {"name": "mem_rage_4", "save_as": "memory_rage_4.png",
     "prompt": (
         "A grey-suited Omni-Corp tax officer seen from directly behind "
         "walking away down a dim municipal cyberpunk corridor: "
         "confiscated battered cyberdeck tucked under his right arm, thin "
         "compliance tablet clutched in his left hand, impeccable pressed "
         "grey suit, sparse combed hair, exposed thin neck above the "
         "starched collar, linoleum floor reflecting his silhouette, cold "
         "fluorescent ceiling tubes flickering in sequence, a numbered "
         "frosted glass door clicking closed at the far end of the hall. "
         "Medium long framing from chest height, shallow depth of field on "
         "his receding back, institutional bureaucratic atmosphere. Quiet "
         "humiliation. " + MEM_STYLE
     )},
    {"name": "mem_rage_5", "save_as": "memory_rage_5.png",
     "prompt": (
         "A cyberpunk street scene on two planes: foreground — a gaunt "
         "middle-aged Purity preacher in grey robes standing on an "
         "overturned plastic crate mid-sermon, one calloused hand raised "
         "in exhortation, round wire-frame glasses catching the firelight, "
         "shaved pale scalp, thin lips pulled tight in zealous calm, a "
         "weathered leather book pressed to his chest; background — a "
         "cyberpunk street clinic fully engulfed in orange flames, black "
         "smoke rising into the neon-drenched sky, onlookers standing "
         "motionless silhouetted against the fire, not intervening. "
         "Dramatic shallow depth of field on the preacher's glasses mirroring "
         "the flames, wide cinematic framing. Violent hypocrisy. "
         + MEM_STYLE
     )},

    # ---------------- AWE ----------------
    {"name": "mem_awe_1", "save_as": "memory_awe_1.png",
     "prompt": (
         "A single lone human silhouette suspended weightless at the center "
         "of a limitless ocean of raw data: endless currents of cyan and "
         "pure white light streaming in every direction around the figure, "
         "luminous geometric glyphs drifting past like deep-sea creatures, "
         "the body backlit into a pure silhouette with arms slightly "
         "spread, hair drifting upward as if underwater, thousands of tiny "
         "angular data-particles swirling in slow vortices. Wide angle "
         "god-scale composition, deep cool-tinted vignette, overexposure "
         "on the brightest data currents, sense of infinite recession. The "
         "transcendent shock of first deep-dive immersion. " + MEM_STYLE
     )},
    {"name": "mem_awe_2", "save_as": "memory_awe_2.png",
     "prompt": (
         "A luminous translucent AI visage named Lattice suspended in an "
         "absolute dark void: the face composed of soft flowing strands of "
         "data-light, androgynous and gently sad, the eyes half-closed, "
         "one open palm raised chest-level in quiet refusal, soft magenta "
         "and cyan particles orbiting the head, a faint halo of scrolling "
         "code fragments behind the skull, thin tendrils of light "
         "descending from where a throat would be into the darkness. "
         "Chest-up framing, dramatic back-lighting, soft bloom, cool "
         "tint, heavy vignette. The quiet birth of a moral machine. "
         + MEM_STYLE
     )},
    {"name": "mem_awe_3", "save_as": "memory_awe_3.png",
     "prompt": (
         "A massive cyberpunk holographic billboard of a smiling Omni-Corp "
         "corporate face peeling back from the center to reveal raw "
         "wireframe reality beneath: glowing cyan polygonal grid lines and "
         "a geometric skeletal architecture bleeding through the glossy "
         "advertisement, torn strips of projected image flapping at the "
         "revealed edges, a small lone silhouetted figure on the wet "
         "sidewalk far below looking up, rain falling through the exposed "
         "grid, distant traffic streaks of red and white below. Upward "
         "wide cinematic framing, extreme scale contrast between the tiny "
         "observer and the vast billboard, digital artifact bleed. A city "
         "glitching itself open. " + MEM_STYLE
     )},
    {"name": "mem_awe_4", "save_as": "memory_awe_4.png",
     "prompt": (
         "The immense featureless black wall at the edge of the cyberpunk "
         "city seen from a rubble-strewn dead plain at dusk: a single "
         "perfect cyan pulse wave radiating outward from its smooth "
         "surface, concentric ripples distorting the air around it, three "
         "small anonymous silhouettes on the plain looking up at it with "
         "their shadows lengthening in the wave's glow, no visible horizon "
         "beyond the wall, a cold dark gradient sky with a few hard stars. "
         "Wide low-angle composition, monumental vertical scale, cool "
         "tinted vignette, slight overexposure on the pulse. The edge of "
         "the known grid. " + MEM_STYLE
     )},
    {"name": "mem_awe_5", "save_as": "memory_awe_5.png",
     "prompt": (
         "The vast silent interior of an abandoned cyberpunk arcology seen "
         "from the very bottom of its central atrium looking straight up: "
         "endless empty residential balconies stacked hundreds of stories "
         "high in concentric rings diminishing toward a distant circle of "
         "cold grey daylight, a single shaft of blue daylight falling "
         "perfectly straight down the core, dust motes suspended and "
         "drifting in the beam, dead potted plants on a few balconies, a "
         "faded promotional banner hanging askew, not a single person "
         "visible. Extreme wide-angle upward composition, overwhelming "
         "vertical scale, deep perspective lines, architectural awe, "
         "monumental stillness. " + MEM_STYLE
     )},

    # ---------------- GRIEF ----------------
    {"name": "mem_grief_1", "save_as": "memory_grief_1.png",
     "prompt": (
         "Warm lamp-lit interior of a small cyberpunk apartment, tabletop "
         "POV: a handwritten sheet of original song lyrics on creased "
         "notebook paper lies in the center of a scarred wooden table, "
         "lines crossed out and rewritten in blue pen, a coffee ring "
         "bleeding across one verse, a battered acoustic guitar lying on "
         "its side just out of focus behind the page, a half-empty chipped "
         "mug, a faded band-logo sticker curling at the table edge, a pack "
         "of cheap cigarettes. Soft pink and cyan neon signs bleed through "
         "a rain-streaked window in the deep background. Shallow depth of "
         "field on the lyrics, quiet warm domestic light. The absence of "
         "the person who wrote the song. " + MEM_STYLE
     )},
    {"name": "mem_grief_2", "save_as": "memory_grief_2.png",
     "prompt": (
         "A dim cyberpunk apartment hallway at 2 AM: a single plain locked "
         "apartment door seen head-on, a crisp red eviction notice pinned "
         "at eye level with three overdue rent notices layered beneath, "
         "paint peeling in strips around the frame, a child's faded "
         "cartoon-dog sticker stuck near the handle, a scuffed rubber "
         "doormat where the word HOME is barely legible, a single "
         "flickering ceiling fluorescent tube overhead, scuff marks on the "
         "wall. Eye-level framing on the door, shallow depth of field on "
         "the notices, heavy vignette, cold hallway light against a warmer "
         "light bleeding under the doorframe from inside. The home you can "
         "no longer afford to enter. " + MEM_STYLE
     )},
    {"name": "mem_grief_3", "save_as": "memory_grief_3.png",
     "prompt": (
         "Rows of plain numbered metal cyberpunk gravestones set in wet "
         "gravel under a heavy dusk downpour: wilted synthetic flowers "
         "draped across one fresh plot, water streaming down the "
         "engraved plaques, puddles pooling between the rows, a lone "
         "figure in a dark raincoat hurrying through the cemetery in the "
         "far background silhouetted against the distant neon skyline, "
         "their face not visible, low cloud cover. Waist-height POV "
         "behind the nearest grave, shallow depth of field pulling focus "
         "onto the wilted flowers, the rain rendered as fine streaks, "
         "cold wet blues against warmer distant neon. Arrival too late. "
         + MEM_STYLE
     )},
    {"name": "mem_grief_4", "save_as": "memory_grief_4.png",
     "prompt": (
         "A human face reflected across a shattered cyberpunk bathroom "
         "mirror, multiple fractured shards each holding a version of the "
         "same tired eyes staring back: faint surgical scars along the jaw "
         "and temples where chrome augments were removed or never "
         "installed, dark circles, chapped lips, a single bare incandescent "
         "bulb above casting hard downward shadows, a grimy ceramic sink "
         "with water dripping from a loose tap, a single razor blade "
         "balanced on the sink edge, a cracked bar of soap. Close framing "
         "across the broken mirror, sharp fracture lines dividing the "
         "face, harsh top-down light, heavy vignette. The face you had "
         "before all of this. " + MEM_STYLE
     )},
    {"name": "mem_grief_5", "save_as": "memory_grief_5.png",
     "prompt": (
         "A concrete cyberpunk alley wall at night seen close: a name once "
         "handwritten in black marker now violently scratched out with a "
         "sharp tool, the fresh pale gouges cutting through layers of old "
         "paint and graffiti, the erasure obviously recent, other "
         "unaffected graffiti tags surrounding the scar, a single red "
         "neon sign from around the nearby corner washing the wall in "
         "bloody light, wet pavement at the base reflecting the red glow, "
         "a discarded marker cap on the ground. Tight close wall-level "
         "framing, harsh angled side light, red-shifted palette. The "
         "deliberate forgetting of someone loved. " + MEM_STYLE
     )},

    # ---------------- Emotion fallbacks ----------------
    {"name": "mem_joy_default", "save_as": "memory_joy_default.png",
     "prompt": (
         "An unidentified pedestrian seen mostly from behind half-turning "
         "on a warm cyberpunk street, a genuine smile visible in profile, "
         "pink and gold neon spilling across one shoulder, steam rising "
         "from a street food cart in the foreground, blurred anonymous "
         "pedestrians moving past, a single strand of loose hair catching "
         "the warm light, wet sidewalk reflecting the signage. Shallow "
         "depth of field, imperfect natural framing, the bittersweet "
         "warmth of a small unclaimed joyful moment. " + MEM_STYLE
     )},
    {"name": "mem_fear_default", "save_as": "memory_fear_default.png",
     "prompt": (
         "A wet cyberpunk alley at 3 AM with a tall shadowy figure "
         "resolving at the far end: long unstructured coat, asymmetrical "
         "silhouette with something wrong about the posture, face not "
         "visible, framed by saturated magenta and cyan neon, heavy rain "
         "falling vertically, sodden newspapers pooled on the pavement, "
         "one surviving streetlamp halfway down the alley casting a lonely "
         "cone. Narrow forced-perspective framing, deep vignette. The "
         "instant before a threat resolves into something specific. "
         + MEM_STYLE
     )},
    {"name": "mem_rage_default", "save_as": "memory_rage_default.png",
     "prompt": (
         "A scarred cyberpunk fist clenched low and held rigid against a "
         "neon-lit street backdrop: old split-skin scars pale against "
         "recent bruising, a fresh cut beginning to bleed at one knuckle, "
         "knuckle-implant augments slightly extended, a broken shop "
         "window behind leaking red and pink neon onto the wet sidewalk, "
         "a dropped object out-of-focus near the bottom of frame. Close "
         "low-angle composition, shallow depth of field, heavy vignette, "
         "red-weighted palette. Unresolved violence. " + MEM_STYLE
     )},
    {"name": "mem_awe_default", "save_as": "memory_awe_default.png",
     "prompt": (
         "A lone unidentified cyberpunk figure standing on a rain-wet "
         "rooftop in three-quarter view looking up at something immense "
         "and luminous just off-frame above: their face upturned and "
         "backlit in cold cyan-white light, mouth slightly parted, arms "
         "hanging loose at their sides, small against the implied scale, "
         "distant neon city blurred far below them, reflected light in "
         "the puddles at their feet. Low three-quarter framing, shallow "
         "depth of field, heavy cool tint. Hush. " + MEM_STYLE
     )},
    {"name": "mem_grief_default", "save_as": "memory_grief_default.png",
     "prompt": (
         "An empty wooden chair beside a rain-streaked window in a dim "
         "cyberpunk apartment interior: the chair slightly turned as if "
         "recently vacated, a folded grey blanket draped over its back, a "
         "small potted plant dying on the windowsill, a half-drunk cup of "
         "tea going cold on a side table, a closed book face-down, "
         "distant neon signs softly blurred through the runnels of rain "
         "on the glass. No human figures. Waist-height framing across "
         "the quiet room, shallow depth of field on the chair, warm fade, "
         "soft vignette. Absence. " + MEM_STYLE
     )},
]

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

def build_mem_wf(job):
    return qwen_image_workflow(
        positive=job["prompt"],
        width=MEM_SIZE[0], height=MEM_SIZE[1],
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
    if mode == "memories":
        run_jobs(MEMORY_IMAGE_JOBS, build_mem_wf, ".png", MEM_DEST)
    if mode == "memories-test":
        run_jobs(MEMORY_IMAGE_JOBS[:1], build_mem_wf, ".png", MEM_DEST)
    if mode == "memories-one":
        # python comfy_batch.py memories-one mem_joy_1
        name = sys.argv[2] if len(sys.argv) > 2 else None
        picks = [j for j in MEMORY_IMAGE_JOBS if j["name"] == name]
        if not picks:
            print(f"no memory job named {name}. valid: {', '.join(j['name'] for j in MEMORY_IMAGE_JOBS)}")
        else:
            run_jobs(picks, build_mem_wf, ".png", MEM_DEST)
    print("\nDone.")

if __name__ == "__main__":
    main()
