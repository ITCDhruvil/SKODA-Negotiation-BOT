"""The small talk around a vendor's price: how it reacts to our offer, and the "let me check" pauses.

These make the simulated vendor read like a person who responds to what was just said, instead of
announcing a number. All wording is repeatable: the choice depends only on the round and the size of
the gap, never on chance. Nothing here names a limit, a reserve or software.
"""
from __future__ import annotations

from typing import Optional

# How far our offer was from the vendor's price, as a share of the vendor's price.
BIG, MID = 0.08, 0.03

_REACT = {
    ("buy", "big"): {
        "en": ["That is quite a bit lower than I can manage.", "Honestly, that is far from my cost.",
               "I cannot work at that level, sorry."],
        "hi": ["यह मेरी लागत से काफ़ी कम है।", "इस स्तर पर काम करना मेरे लिए मुश्किल है।"],
        "mr": ["हे माझ्या खर्चापेक्षा बरेच कमी आहे.", "या पातळीवर काम करणे मला कठीण आहे."],
    },
    ("buy", "mid"): {
        "en": ["That is closer, but still tight for me.", "I see where you are coming from, but it is still low for me.",
               "We are getting there, though it is not easy."],
        "hi": ["यह कुछ करीब है, पर मेरे लिए अभी भी कम है।", "हम आगे बढ़ रहे हैं, पर आसान नहीं है।"],
        "mr": ["हे थोडे जवळ आहे, पण माझ्यासाठी अजून कमी आहे.", "आपण पुढे जात आहोत, पण सोपे नाही."],
    },
    ("buy", "small"): {
        "en": ["We are not far apart now.", "We are almost there.", "That is much closer, thank you."],
        "hi": ["अब हम ज़्यादा दूर नहीं हैं।", "हम लगभग पहुँच गए हैं।"],
        "mr": ["आता आपण फार दूर नाही.", "आपण जवळजवळ पोहोचलो आहोत."],
    },
    ("sell", "big"): {
        "en": ["That is much more than I can pay.", "That is far above what I can offer.",
               "I cannot stretch that far, sorry."],
        "hi": ["यह मेरी क्षमता से काफ़ी ज़्यादा है।", "इतना देना मेरे लिए संभव नहीं है।"],
        "mr": ["हे माझ्या क्षमतेपेक्षा बरेच जास्त आहे.", "इतके देणे मला शक्य नाही."],
    },
    ("sell", "mid"): {
        "en": ["That is closer, but still a stretch for me.", "I see your point, but it is still high for me.",
               "We are getting there, though it is not easy."],
        "hi": ["यह कुछ करीब है, पर मेरे लिए अभी भी ज़्यादा है।", "हम आगे बढ़ रहे हैं, पर आसान नहीं है।"],
        "mr": ["हे थोडे जवळ आहे, पण माझ्यासाठी अजून जास्त आहे.", "आपण पुढे जात आहोत, पण सोपे नाही."],
    },
    ("sell", "small"): {
        "en": ["We are not far apart now.", "We are almost there.", "That is much closer, thank you."],
        "hi": ["अब हम ज़्यादा दूर नहीं हैं।", "हम लगभग पहुँच गए हैं।"],
        "mr": ["आता आपण फार दूर नाही.", "आपण जवळजवळ पोहोचलो आहोत."],
    },
}

_PAUSE = {
    "en": ["Give me a minute, let me check with my team.", "Let me talk to my manager and come back to you.",
           "One moment, I need to check the numbers on my side.", "Hold on, let me see what is possible."],
    "hi": ["एक मिनट दीजिए, मैं अपनी टीम से पूछ लेता हूँ।", "मैं मैनेजर से बात करके बताता हूँ।"],
    "mr": ["एक मिनिट द्या, मी टीमशी बोलून सांगतो.", "मी मॅनेजरशी बोलून कळवतो."],
}


def reaction(direction: str, lang: str, gap: Optional[float], variant: int) -> str:
    """One sentence reacting to how far our offer was from its price; empty when there is nothing to react to."""
    if gap is None:
        return ""
    bucket = "big" if gap > BIG else "mid" if gap > MID else "small"
    pool = _REACT[(direction, bucket)][lang]
    return pool[variant % len(pool)]


def pause(lang: str, variant: int) -> str:
    """A short message sent before the real answer, as when someone checks with a colleague first."""
    pool = _PAUSE[lang]
    return pool[variant % len(pool)]


def pauses_before(round_no: int, kind: str) -> bool:
    """Every third reply that moves the price is preceded by a pause (the first reply never is)."""
    return kind == "counter" and round_no >= 1 and round_no % 3 == 1
