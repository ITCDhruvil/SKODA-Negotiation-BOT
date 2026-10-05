"""The small talk around a vendor's price: how it reacts to our offer, and the "let me check" pauses.

These make the simulated vendor read like a person who responds to what was just said, instead of
announcing a number. All wording is repeatable: the choice depends only on the round and the size of
the gap, never on chance. Nothing here names a limit, a reserve or software.
"""
from __future__ import annotations

import zlib
from typing import Optional

from app import ids
from app.negotiation.personas import SCRIPTED_BIDS

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
           "One moment, I need to check the numbers on my side.", "Hold on, let me see what is possible.",
           "Let me check the stock and current rates, I will be back shortly.", "Give me five minutes, I need to confirm something.",
           "Let me ask the purchase side and revert."],
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


def pauses_before(round_no: int, kind: str, bid_id: Optional[str] = None) -> bool:
    """Whether a price move is preceded by a "let me check" pause.

    The fixed demo stories keep every third move. Any other vendor pauses at most twice, in rounds that depend on
    the bid, and some not at all, so it does not read as a habit.
    """
    if kind != "counter" or round_no < 1:
        return False
    if bid_id is None or bid_id in SCRIPTED_BIDS:
        return round_no % 3 == 1
    h = zlib.crc32(f"pause-plan:{ids.legacy_key(bid_id)}".encode("utf-8"))
    if h % 10 < 3:
        return False  # three vendors in ten never stop to check
    first = 2 + (h >> 4) % 3
    return round_no in (first, first + 3 + (h >> 8) % 3) if h % 10 < 8 else round_no == first


# --- how long replies take (conversation time, not real time) -------------------------------------
# A reply to a plain offer comes within the hour. When the vendor says it will check and come back, the answer
# takes hours or days, depending on how the vendor behaves. Minutes, chosen from the bid and round only.
_BACK_RANGE = {  # persona -> (shortest, longest) wait after "let me check and come back"
    "cooperative": (120, 360), "deadline": (60, 240), "relationship": (180, 600),
    "terms": (360, 1200), "bluffer": (480, 1440), "anchor": (1440, 4320),
}


def _pick(seed: str, lo: int, hi: int) -> int:
    return lo + zlib.crc32(ids.legacy_key(seed).encode("utf-8")) % max(1, hi - lo)


def our_delay(bid_id: str, round_no: int) -> int:
    """Minutes between the vendor's last message and ours."""
    return _pick(f"us:{bid_id}:{round_no}", 4, 26)


def reply_delay(persona: str, bid_id: str, round_no: int, after_pause: bool) -> int:
    """Minutes between our message (or the vendor's pause message) and the vendor's answer."""
    if after_pause:
        lo, hi = _BACK_RANGE.get(persona, _BACK_RANGE["cooperative"])
        return _pick(f"back:{bid_id}:{round_no}", lo, hi)
    return _pick(f"reply:{bid_id}:{round_no}", 5, 41)


def pause_delay(bid_id: str, round_no: int) -> int:
    """The "let me check" message itself comes quickly."""
    return _pick(f"pause:{bid_id}:{round_no}", 3, 12)


# --- disapproval: how a vendor pushes back, refuses and walks away ---------------------------------
# Three kinds. "replace" lines stand in for the usual price message, "before" lines come ahead of it and
# "after" lines are added to it. They use {price} and {unit}; none names a limit, a target or software.
KIND = {"frustrated": "before", "nothing_left": "replace", "ultimatum": "replace", "rescope": "replace",
        "walkaway": "replace", "deadline": "after", "nibble": "after"}

_FLAVOUR = {
    ("frustrated", "*"): {
        "en": ["That is far from where I can go. I need a realistic number to continue.",
               "Honestly, small steps like this do not help me. I need a serious number.",
               "I am trying to work with you, but this is getting difficult."],
        "hi": ["यह मेरी सीमा से काफ़ी दूर है। आगे बढ़ने के लिए मुझे एक वास्तविक संख्या चाहिए।",
               "ईमानदारी से कहूँ तो ऐसे छोटे कदमों से बात नहीं बनती।"],
        "mr": ["हे माझ्या मर्यादेपासून बरेच दूर आहे. पुढे जाण्यासाठी मला खरा आकडा हवा.",
               "खरे सांगायचे तर असे लहान पाऊल उपयोगी नाही."],
    },
    ("nothing_left", "*"): {
        "en": ["I have really got nothing left to give on price. {price} per {unit} is it.",
               "I have gone as far as I can. {price} per {unit} is all I have in this."],
        "hi": ["कीमत पर मेरे पास अब देने के लिए कुछ नहीं बचा है। {price} प्रति {unit} ही है।"],
        "mr": ["किंमतीवर माझ्याकडे आता देण्यासाठी काही उरलेले नाही. {price} प्रति {unit} हेच आहे."],
    },
    ("ultimatum", "*"): {
        "en": ["{price} per {unit} is my final price. Take it or leave it.",
               "I cannot do better than {price} per {unit}. That is my last word."],
        "hi": ["{price} प्रति {unit} मेरी अंतिम कीमत है। लेना हो तो लीजिए।"],
        "mr": ["{price} प्रति {unit} ही माझी अंतिम किंमत आहे. घ्यायचे तर घ्या."],
    },
    ("rescope", "buy"): {
        "en": ["At that price I can only do a lower grade or a smaller lot. For the full quantity as quoted, {price} per {unit} stays.",
               "That level does not cover my cost. If you want it that low, I would have to change the grade or add charges. Otherwise it stays at {price} per {unit}."],
        "hi": ["उस कीमत पर मैं केवल कम ग्रेड या छोटा लॉट दे सकता हूँ। पूरी मात्रा के लिए {price} प्रति {unit} ही रहेगा।"],
        "mr": ["त्या किंमतीत मी फक्त कमी ग्रेड किंवा छोटा लॉट देऊ शकतो. पूर्ण प्रमाणासाठी {price} प्रति {unit} राहील."],
    },
    ("rescope", "sell"): {
        "en": ["At that rate I can only take part of the lot, or take it as it is without sorting. For the full lot, {price} per {unit} stays.",
               "That is more than I can pay for all of it. I would have to take a smaller quantity, or deduct for mixed material. Otherwise it stays at {price} per {unit}."],
        "hi": ["उस भाव पर मैं लॉट का केवल हिस्सा ले सकता हूँ। पूरे लॉट के लिए {price} प्रति {unit} ही रहेगा।"],
        "mr": ["त्या भावात मी लॉटचा फक्त काही भाग घेऊ शकतो. संपूर्ण लॉटसाठी {price} प्रति {unit} राहील."],
    },
    ("walkaway", "*"): {
        "en": ["I am sorry, I cannot make that work. {price} per {unit} was the best I could do. If your budget changes, let me know.",
               "Then I will leave it here. {price} per {unit} was my best. Do reach out if things change."],
        "hi": ["क्षमा कीजिए, यह मेरे लिए संभव नहीं है। {price} प्रति {unit} मेरा सबसे अच्छा था। बजट बदले तो बताइएगा।"],
        "mr": ["माफ करा, हे मला जमणार नाही. {price} प्रति {unit} हेच माझे सर्वोत्तम होते. बजेट बदलले तर कळवा."],
    },
    ("deadline", "*"): {
        "en": ["This rate holds only until tomorrow evening, then I will have to re-quote.",
               "I have to confirm this by tomorrow, so I can hold it for a day."],
        "hi": ["यह दर केवल कल शाम तक है, उसके बाद मुझे दोबारा भाव देना होगा।"],
        "mr": ["हा दर फक्त उद्या संध्याकाळपर्यंत आहे, त्यानंतर मला पुन्हा भाव द्यावा लागेल."],
    },
    ("nibble", "buy"): {
        "en": ["On one condition: you arrange the pickup from our works.",
               "Fine, as long as the loading is arranged at your end."],
        "hi": ["एक शर्त पर: माल हमारे यहाँ से आप उठवाएँगे।"],
        "mr": ["एका अटीवर: माल आमच्याकडून तुम्ही उचलाल."],
    },
    ("nibble", "sell"): {
        "en": ["On one condition: the loading is done by your team at your end.",
               "Fine, as long as you cover the weighbridge charges."],
        "hi": ["एक शर्त पर: लोडिंग आपकी टीम करेगी।"],
        "mr": ["एका अटीवर: लोडिंग तुमची टीम करेल."],
    },
}


def flavour_line(flavour: str, direction: str, lang: str, variant: int, *, price: str = "", unit: str = "") -> str:
    """The pushback wording for a vendor state, or '' when the state has none."""
    pool = _FLAVOUR.get((flavour, direction)) or _FLAVOUR.get((flavour, "*"))
    if not pool:
        return ""
    lines = pool[lang]
    return lines[variant % len(lines)].format(price=price, unit=unit)


def walk_away_delay(bid_id: str, round_no: int) -> int:
    """A vendor that is leaving goes quiet first: a day or two."""
    return _pick(f"quiet:{bid_id}:{round_no}", 1440, 2880)
