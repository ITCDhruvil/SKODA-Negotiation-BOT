"""Message wording for both sides, in English, Hindi and Marathi.

Messages from our side read like a person at the company wrote them and are signed with a name;
they never mention software, assistants or automation (see guardrails.check_message).
"""
from __future__ import annotations

import os
from typing import Optional

from app import deal

LANGS = ("en", "hi", "mr")
DEFAULT_SIGNATURE = "Dhruvil Patel\nSKODA Auto VW India, Pune"


def signature() -> str:
    """The name at the foot of our messages: NEGOTIATION_SIGNATURE (a literal \n is a line break)."""
    configured = os.environ.get("NEGOTIATION_SIGNATURE", "").strip()
    return configured.replace("\\n", "\n") if configured else DEFAULT_SIGNATURE

_UNIT = {
    "en": {"EA": "unit", "AU": "lot", "KG": "kg", "TON": "ton", "LOT": "lot"},
    "hi": {"EA": "नग", "AU": "लॉट", "KG": "किलो", "TON": "टन", "LOT": "लॉट"},
    "mr": {"EA": "नग", "AU": "लॉट", "KG": "किलो", "TON": "टन", "LOT": "लॉट"},
}


def _group(n: int) -> str:
    """Indian digit grouping: 1,23,456."""
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts + [tail])
    return ("-" if n < 0 else "") + s


_signature = signature  # our_message has a parameter of the same name


def _paise(x: float) -> int:
    """Whole paise, rounded half up, so 46.996 is 4700 and not 4699.6."""
    return int(abs(x) * 100 + 0.5)


def money(x: float) -> str:
    """₹ amount with Indian grouping; paise only when present; a minus sign for negatives."""
    total = _paise(x)
    whole, paise = divmod(total, 100)
    sign = "-" if x < 0 and total else ""
    body = _group(whole) if not paise else f"{_group(whole)}.{paise:02d}"
    return f"{sign}₹{body}"


def _qty(x: float) -> str:
    if x == int(x):
        return _group(int(x))
    whole, paise = divmod(_paise(x), 100)
    sign = "-" if x < 0 else ""
    return f"{sign}{_group(whole)}.{paise:02d}"


def _qty_unit(lang: str, unit: str, qty: float) -> str:
    """The unit word that follows a quantity; English adds an s for anything but exactly one."""
    word = _UNIT[lang].get(unit, unit)
    if lang == "en" and qty != 1 and word in ("unit", "lot"):
        return word + "s"
    return word


def payment_phrase(lang: str, direction: str, code: Optional[str]) -> str:
    """A sentence about payment timing, or '' when there is nothing to ask."""
    if not code:
        return ""
    days = deal.payment_days(code)
    if direction == "buy":  # we pay: we ask for more days
        return {
            "en": f" Also, could we settle the payment in {days} days?",
            "hi": f" साथ ही, क्या हम भुगतान {days} दिन में कर सकते हैं?",
            "mr": f" तसेच, आम्ही पेमेंट {days} दिवसांत केले तर चालेल का?",
        }[lang]
    if days == 0:  # we are paid: we ask for it sooner
        return {
            "en": " We would also need the payment in advance.",
            "hi": " साथ ही भुगतान अग्रिम रूप से चाहिए।",
            "mr": " तसेच पेमेंट आगाऊ हवे आहे.",
        }[lang]
    return {
        "en": f" We would also need the payment within {days} days.",
        "hi": f" साथ ही भुगतान {days} दिन के भीतर चाहिए।",
        "mr": f" तसेच पेमेंट {days} दिवसांच्या आत हवे आहे.",
    }[lang]


def _agreed_payment(lang: str, code: Optional[str]) -> str:
    if not code:
        return ""
    days = deal.payment_days(code)
    if days == 0:
        return {"en": " Payment in advance.", "hi": " भुगतान अग्रिम।", "mr": " पेमेंट आगाऊ."}[lang]
    return {
        "en": f" Payment in {days} days.",
        "hi": f" भुगतान {days} दिन में।",
        "mr": f" पेमेंट {days} दिवसांत.",
    }[lang]


# (kind, event direction, language) -> template. Placeholders: {vendor} {item} {qty} {unit}
# {quote} {price} {pay} {sign}
_OURS: dict[tuple[str, str, str], str] = {
    ("open", "buy", "en"): (
        "Hello{vendor} team, thank you for your quotation of {quote} per {unit} for {qty} {qty_unit} of "
        "{item}. For this quantity we were looking at around {price} per {unit}. Could you please "
        "revisit your price?{pay}\n\nRegards,\n{sign}"),
    ("open", "buy", "hi"): (
        "नमस्कार{vendor} टीम, {item} ({qty} {unit}) के लिए {quote} प्रति {unit} का कोटेशन देने के लिए "
        "धन्यवाद। इस मात्रा के लिए हम लगभग {price} प्रति {unit} की उम्मीद कर रहे थे। क्या आप कृपया "
        "अपनी कीमत पर पुनर्विचार कर सकते हैं?{pay}\n\nधन्यवाद,\n{sign}"),
    ("open", "buy", "mr"): (
        "नमस्कार{vendor} टीम, {item} ({qty} {unit}) साठी {quote} प्रति {unit} दराने कोटेशन दिल्याबद्दल "
        "धन्यवाद. या प्रमाणासाठी आम्हाला साधारण {price} प्रति {unit} अपेक्षित होते. कृपया आपल्या "
        "किमतीचा पुनर्विचार कराल का?{pay}\n\nधन्यवाद,\n{sign}"),
    ("counter", "buy", "en"): (
        "Thanks for coming back to us. We can move to {price} per {unit}.{pay} Would that work for "
        "you?\n\nRegards,\n{sign}"),
    ("counter", "buy", "hi"): (
        "आपके जवाब के लिए धन्यवाद। हम {price} प्रति {unit} तक आ सकते हैं।{pay} क्या यह आपको मंज़ूर "
        "होगा?\n\nधन्यवाद,\n{sign}"),
    ("counter", "buy", "mr"): (
        "उत्तर दिल्याबद्दल धन्यवाद. आम्ही {price} प्रति {unit} या दरापर्यंत येऊ शकतो.{pay} हे आपल्याला "
        "मान्य आहे का?\n\nधन्यवाद,\n{sign}"),
    ("close", "buy", "en"): (
        "Thank you. If you can do {price} per {unit}, we can go ahead with the order today.{pay}"
        "\n\nRegards,\n{sign}"),
    ("close", "buy", "hi"): (
        "धन्यवाद। अगर आप {price} प्रति {unit} कर दें तो हम आज ही ऑर्डर आगे बढ़ा सकते हैं।{pay}"
        "\n\nधन्यवाद,\n{sign}"),
    ("close", "buy", "mr"): (
        "धन्यवाद. जर आपण {price} प्रति {unit} केले तर आम्ही ऑर्डर आजच निश्चित करू शकतो.{pay}"
        "\n\nधन्यवाद,\n{sign}"),
    ("accept", "buy", "en"): (
        "Alright, {price} per {unit} is fine with us.{pay} Thank you for working with us on this."
        "\n\nRegards,\n{sign}"),
    ("accept", "buy", "hi"): (
        "ठीक है, {price} प्रति {unit} हमें मंज़ूर है।{pay} इसमें सहयोग के लिए धन्यवाद।"
        "\n\nसादर,\n{sign}"),
    ("accept", "buy", "mr"): (
        "ठीक आहे, {price} प्रति {unit} आम्हाला मान्य आहे.{pay} सहकार्याबद्दल धन्यवाद."
        "\n\nकळावे,\n{sign}"),
    ("open", "sell", "en"): (
        "Hello{vendor} team, thank you for your bid of {quote} per {unit} for {qty} {qty_unit} of "
        "{item}. Going by current market levels we were expecting around {price} per {unit}. Could "
        "you please revisit your bid?{pay}\n\nRegards,\n{sign}"),
    ("open", "sell", "hi"): (
        "नमस्कार{vendor} टीम, {item} ({qty} {unit}) के लिए {quote} प्रति {unit} की बोली के लिए "
        "धन्यवाद। मौजूदा बाज़ार भाव को देखते हुए हम लगभग {price} प्रति {unit} की उम्मीद कर रहे थे। "
        "क्या आप अपनी बोली पर पुनर्विचार कर सकते हैं?{pay}\n\nधन्यवाद,\n{sign}"),
    ("open", "sell", "mr"): (
        "नमस्कार{vendor} टीम, {item} ({qty} {unit}) साठी {quote} प्रति {unit} बोली दिल्याबद्दल "
        "धन्यवाद. सध्याच्या बाजारभावानुसार आम्हाला साधारण {price} प्रति {unit} अपेक्षित होते. कृपया "
        "आपल्या बोलीचा पुनर्विचार कराल का?{pay}\n\nधन्यवाद,\n{sign}"),
    ("counter", "sell", "en"): (
        "Thanks for the revised bid. We can come down to {price} per {unit}.{pay} Would that work "
        "for you?\n\nRegards,\n{sign}"),
    ("counter", "sell", "hi"): (
        "संशोधित बोली के लिए धन्यवाद। हम {price} प्रति {unit} तक आ सकते हैं।{pay} क्या यह आपको "
        "मंज़ूर होगा?\n\nधन्यवाद,\n{sign}"),
    ("counter", "sell", "mr"): (
        "सुधारित बोलीबद्दल धन्यवाद. आम्ही {price} प्रति {unit} या दरापर्यंत खाली येऊ शकतो.{pay} हे "
        "आपल्याला मान्य आहे का?\n\nधन्यवाद,\n{sign}"),
    ("close", "sell", "en"): (
        "Thank you. If you can do {price} per {unit}, we can release the lot to you this week.{pay}"
        "\n\nRegards,\n{sign}"),
    ("close", "sell", "hi"): (
        "धन्यवाद। अगर आप {price} प्रति {unit} कर दें तो हम इसी हफ़्ते माल आपको दे सकते हैं।{pay}"
        "\n\nधन्यवाद,\n{sign}"),
    ("close", "sell", "mr"): (
        "धन्यवाद. जर आपण {price} प्रति {unit} केले तर आम्ही याच आठवड्यात माल आपल्याला देऊ शकतो.{pay}"
        "\n\nधन्यवाद,\n{sign}"),
    ("accept", "sell", "en"): (
        "Alright, {price} per {unit} is fine with us.{pay} Thank you.\n\nRegards,\n{sign}"),
    ("accept", "sell", "hi"): (
        "ठीक है, {price} प्रति {unit} हमें मंज़ूर है।{pay} धन्यवाद।\n\nसादर,\n{sign}"),
    ("accept", "sell", "mr"): (
        "ठीक आहे, {price} प्रति {unit} आम्हाला मान्य आहे.{pay} धन्यवाद.\n\nकळावे,\n{sign}"),
}

# (kind, event direction, language). In a buy event the vendor sells; in a sell event the vendor buys.
_VENDOR: dict[tuple[str, str, str], str] = {
    ("counter", "buy", "en"): "Thanks for the feedback. For this quantity the best I can do is {price} per {unit}.",
    ("counter", "buy", "hi"): "फीडबैक के लिए धन्यवाद। इस मात्रा के लिए मैं {price} प्रति {unit} तक कर सकता हूँ।",
    ("counter", "buy", "mr"): "प्रतिसादाबद्दल धन्यवाद. या प्रमाणासाठी मी {price} प्रति {unit} पर्यंत करू शकतो.",
    ("hold", "buy", "en"): "I understand you need a better price, but {price} per {unit} already reflects current material and transport costs. It is difficult for me to move right now.",
    ("hold", "buy", "hi"): "मैं समझता हूँ कि आपको बेहतर कीमत चाहिए, लेकिन {price} प्रति {unit} में मौजूदा सामग्री और ढुलाई का खर्च शामिल है। अभी कीमत घटाना मुश्किल है।",
    ("hold", "buy", "mr"): "तुम्हाला चांगली किंमत हवी हे मला समजते, पण {price} प्रति {unit} मध्ये सध्याचा माल आणि वाहतूक खर्च धरलेला आहे. सध्या किंमत कमी करणे कठीण आहे.",
    ("hold", "sell", "en"): "I understand you were expecting more, but {price} per {unit} is in line with what the material is fetching for us at the moment. I cannot move right away.",
    ("hold", "sell", "hi"): "मैं समझता हूँ कि आपको ज़्यादा की उम्मीद थी, लेकिन {price} प्रति {unit} अभी हमें इस माल के लिए मिल रहे भाव के अनुसार है। मैं तुरंत नहीं बढ़ा सकता।",
    ("hold", "sell", "mr"): "तुम्हाला जास्त अपेक्षित होते हे मला समजते, पण {price} प्रति {unit} हा सध्या या मालाला मिळणाऱ्या भावानुसार आहे. मी लगेच वाढवू शकत नाही.",
    ("firm", "buy", "en"): "I understand, but {price} per {unit} really is the lowest I can go. That is my final price.",
    ("firm", "buy", "hi"): "मैं समझता हूँ, लेकिन {price} प्रति {unit} इससे कम नहीं हो पाएगा। यही मेरी अंतिम कीमत है।",
    ("firm", "buy", "mr"): "मला समजते, पण {price} प्रति {unit} यापेक्षा कमी होणार नाही. हीच माझी अंतिम किंमत आहे.",
    ("accept", "buy", "en"): "Alright, {price} per {unit} works for us.{pay} We can confirm the order on these terms.",
    ("accept", "buy", "hi"): "ठीक है, {price} प्रति {unit} हमारे लिए चलेगा।{pay} इन शर्तों पर हम ऑर्डर कन्फ़र्म कर सकते हैं।",
    ("accept", "buy", "mr"): "ठीक आहे, {price} प्रति {unit} आम्हाला चालेल.{pay} या अटींवर आम्ही ऑर्डर निश्चित करू शकतो.",
    ("counter", "sell", "en"): "Thanks. I can improve my bid to {price} per {unit}.",
    ("counter", "sell", "hi"): "धन्यवाद। मैं अपनी बोली बढ़ाकर {price} प्रति {unit} कर सकता हूँ।",
    ("counter", "sell", "mr"): "धन्यवाद. मी माझी बोली वाढवून {price} प्रति {unit} करू शकतो.",
    ("firm", "sell", "en"): "That is the most I can pay: {price} per {unit}. It is my final bid.",
    ("firm", "sell", "hi"): "इससे ज़्यादा मैं नहीं दे सकता: {price} प्रति {unit}। यही मेरी अंतिम बोली है।",
    ("firm", "sell", "mr"): "यापेक्षा जास्त मी देऊ शकत नाही: {price} प्रति {unit}. हीच माझी अंतिम बोली आहे.",
    ("accept", "sell", "en"): "Okay, {price} per {unit} is fine.{pay} We can lift the material on these terms.",
    ("accept", "sell", "hi"): "ठीक है, {price} प्रति {unit} मंज़ूर है।{pay} इन शर्तों पर हम माल उठा लेंगे।",
    ("accept", "sell", "mr"): "ठीक आहे, {price} प्रति {unit} मान्य आहे.{pay} या अटींवर आम्ही माल उचलू.",
}

# Extra English wordings so a long conversation does not repeat itself. Variant 0 is the main
# template above; callers pass the round number so the choice is repeatable.
_OURS_ALT: dict[tuple[str, str], list[str]] = {
    ("counter", "buy"): [
        "Appreciate the quick reply. Could you stretch to {price} per {unit}?{pay} That would help us "
        "a lot.\n\nThanks,\n{sign}",
        "Understood. From our side {price} per {unit} is where we can get to.{pay} Let me know if that "
        "works.\n\nBest regards,\n{sign}",
    ],
    ("close", "buy"): [
        "I do see your point. If {price} per {unit} is possible, I can confirm the order right away."
        "{pay}\n\nThanks,\n{sign}",
        "We would like to finalise this with you. At {price} per {unit} we can proceed today.{pay}"
        "\n\nBest regards,\n{sign}",
    ],
    ("accept", "buy"): [
        "Good, {price} per {unit} it is.{pay} Thanks for being flexible.\n\nThanks,\n{sign}",
        "That works for us, {price} per {unit}.{pay} Glad we could close this.\n\nBest regards,\n{sign}",
    ],
    ("counter", "sell"): [
        "Thanks for getting back. We can do {price} per {unit}.{pay} Please let me know.\n\nThanks,\n{sign}",
        "Understood. For the material on offer, {price} per {unit} is where we can settle.{pay}"
        "\n\nBest regards,\n{sign}",
    ],
    ("close", "sell"): [
        "If you can match {price} per {unit}, we can give you the lot this week.{pay}\n\nThanks,\n{sign}",
        "We would like to close this with you. At {price} per {unit} we can proceed right away.{pay}"
        "\n\nBest regards,\n{sign}",
    ],
    ("accept", "sell"): [
        "Good, {price} per {unit} it is.{pay} Thanks for your flexibility.\n\nThanks,\n{sign}",
        "That works, {price} per {unit}.{pay} Glad we could agree.\n\nBest regards,\n{sign}",
    ],
}
_VENDOR_ALT: dict[tuple[str, str], list[str]] = {
    ("hold", "buy"): [
        "Please understand, steel and packing costs have gone up this quarter. {price} per {unit} is already a fair rate and I cannot reduce it just yet.",
        "I have quoted {price} per {unit} keeping your quantity in mind. If you can tell me how you plan to place the order, I will see what is possible.",
        "Our rates are not flexible at the moment because of input costs. {price} per {unit} is what I can stand by for now.",
    ],
    ("counter", "buy"): [
        "Okay, let me see what I can do. {price} per {unit} is possible.",
        "Since you are ordering the full quantity, I can come down a little, to {price} per {unit}.",
        "I spoke to my team. We can do {price} per {unit}, but it is getting tight for us.",
        "Fine, I will adjust a little for the relationship. {price} per {unit}.",
        "This is a stretch for me, but {price} per {unit} I can manage.",
    ],
    ("firm", "buy"): [
        "Sorry, there is not much room left. {price} per {unit} is my last price.",
        "I have already stretched a lot. {price} per {unit} is final from my side.",
        "I really cannot go below {price} per {unit}. That is where my cost sits.",
    ],
    ("accept", "buy"): [
        "Fine, {price} per {unit} is okay.{pay} Please send the order on these terms.",
        "Okay, we have a deal at {price} per {unit}.{pay} I will wait for the order.",
        "Alright, {price} per {unit} then.{pay} Let us close this and I will arrange the dispatch plan.",
    ],
    ("hold", "sell"): [
        "The market for this material has been firm this month. {price} per {unit} is a good rate and I cannot change it just yet.",
        "I bid {price} per {unit} after checking current yard rates. If you can share your pickup schedule, I will look again.",
        "Our rates are fixed by what we get from the mills. {price} per {unit} is what I can stand by for now.",
    ],
    ("counter", "sell"): [
        "Okay, I can go up to {price} per {unit}.",
        "Let me improve it a little, {price} per {unit}.",
        "Since the lot is clean and the quantity is good, I can do {price} per {unit}.",
        "I checked with my buyer. We can stretch to {price} per {unit}, but not much more.",
        "This is a stretch for me, but {price} per {unit} I can manage.",
    ],
    ("firm", "sell"): [
        "Sorry, {price} per {unit} is the best I can offer. That is final.",
        "I cannot go beyond {price} per {unit}. My final bid.",
        "The mills will not pay me more, so {price} per {unit} is where I stop.",
    ],
    ("accept", "sell"): [
        "Fine, {price} per {unit} is okay.{pay} I will arrange the pickup.",
        "Okay, deal at {price} per {unit}.{pay} Tell me when we can lift the material.",
        "Alright, {price} per {unit} then.{pay} I will send the truck as soon as you confirm.",
    ],
}

# Reasons our side gives for a counter or a closing ask (English only), picked by round. They never
# quote another vendor's number and never mention our own limits.
_REASONS: dict[str, list[str]] = {
    "buy": [
        "Prices for similar quantities that we have seen recently are lower.",
        "We are giving the whole quantity to one vendor, so I would like the rate to reflect that.",
        "We prefer long-term vendors and would like to build a regular relationship with you.",
        "I have to justify this rate internally, and the current number is hard to explain.",
        "We have other offers that are closer to what we expected.",
    ],
    "sell": [
        "Current market rates for this grade are higher than the bid.",
        "The lot is clean and the full quantity goes to one buyer, so I would like the rate to reflect that.",
        "We would like to work with a regular buyer for our scrap and would take a good offer.",
        "I have to justify this rate internally, and the current number is hard to explain.",
        "We have other interest in the lot that is closer to what we expected.",
    ],
}


_LEADS = {
    "counter": [
        "Thanks for coming back to us.", "Appreciate the quick reply.", "Understood, thank you for the update.",
        "Thanks, I have noted your position.",
    ],
    "close": [
        "Thank you, we are getting closer.", "I do see your point.", "Thanks for working on this with us.",
        "We would like to finalise this with you.",
    ],
}
_ASKS = {
    ("counter", "buy"): [
        "Could you stretch to {price} per {unit}?{pay}", "We can move to {price} per {unit}.{pay} Would that work?",
        "From our side {price} per {unit} is where we can get to.{pay}",
    ],
    ("close", "buy"): [
        "If {price} per {unit} is possible, I can confirm the order right away.{pay}",
        "At {price} per {unit} we can go ahead with the order today.{pay}",
    ],
    ("counter", "sell"): [
        "Could you improve to {price} per {unit}?{pay}", "We can come down to {price} per {unit}.{pay} Would that work?",
        "From our side {price} per {unit} is where we can settle.{pay}",
    ],
    ("close", "sell"): [
        "If you can match {price} per {unit}, we can release the lot to you this week.{pay}",
        "At {price} per {unit} we can proceed right away.{pay}",
    ],
}
_CLOSINGS = ["Thanks", "Regards", "Best regards"]

_HONORIFICS = {"m/s", "mr", "mr.", "shree", "sri", "the"}


def short_name(vendor_name: str) -> str:
    """The first real word of the vendor's name, without honorifics; '' when nothing is left."""
    words = vendor_name.split()
    while words and words[0].lower() in _HONORIFICS:
        words.pop(0)
    return words[0] if words else ""


def our_message(
    kind: str, *, direction: str, lang: str, vendor_name: str, item: str, qty: float, unit: str,
    quote: float, price: float, payment_ask: Optional[str] = None, agreed_payment: Optional[str] = None,
    signature: Optional[str] = None, variant: int = 0,
) -> str:
    """The text we send. `quote` is the vendor's current price; `price` is what we propose."""
    template = _OURS[(kind, direction, lang)]
    alts = _OURS_ALT.get((kind, direction), []) if lang == "en" else []
    if alts and variant % (len(alts) + 1):
        template = alts[variant % (len(alts) + 1) - 1]
    sign = signature if signature is not None else _signature()
    if signature is None and kind in ("counter", "close"):
        sign = sign.split("\n")[0]  # mid-conversation: just the name, like a real chat
    pay = payment_phrase(lang, direction, payment_ask) if kind != "accept" else _agreed_payment(lang, agreed_payment)
    name = short_name(vendor_name)
    fields = dict(
        vendor=f" {name}" if name else "", item=item, qty=_qty(qty),
        unit=_UNIT[lang].get(unit, unit), qty_unit=_qty_unit(lang, unit, qty),
        quote=money(quote), price=money(price), pay=pay, sign=sign)
    if lang == "en" and kind in ("counter", "close") and variant > 0:
        # Later rounds are written from parts: an acknowledgement, a reason, then the ask.
        leads, asks = _LEADS[kind], _ASKS[(kind, direction)]
        reasons = _REASONS[direction]
        text = " ".join([
            leads[variant % len(leads)], reasons[(variant - 1) % len(reasons)],
            asks[(variant // 2) % len(asks)].format(**fields)])
        closing = _CLOSINGS[variant % len(_CLOSINGS)]
        return text + "\n\n" + closing + ",\n" + sign
    return template.format(**fields)


def vendor_message(
    kind: str, *, direction: str, lang: str, price: float, unit: str, payment: Optional[str] = None,
    variant: int = 0,
) -> str:
    """The simulated vendor's reply text."""
    template = _VENDOR[(kind, direction, lang)]
    alts = _VENDOR_ALT.get((kind, direction), []) if lang == "en" else []
    if alts and variant % (len(alts) + 1):
        template = alts[variant % (len(alts) + 1) - 1]
    return template.format(
        price=money(price), unit=_UNIT[lang].get(unit, unit),
        pay=_agreed_payment(lang, payment) if payment else "")
