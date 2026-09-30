"""Message wording for both sides, in English, Hindi and Marathi.

Messages from our side read like a person at the company wrote them and are signed with a name;
they never mention software, assistants or automation (see guardrails.check_message).
"""
from __future__ import annotations

from typing import Optional

from app import deal

LANGS = ("en", "hi", "mr")
SIGNATURE = "Dhruvil Patel\nSKODA Auto VW India, Pune"

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


def money(x: float) -> str:
    """₹ amount with Indian grouping; paise only when present."""
    whole = int(x)
    if x == whole:
        return f"₹{_group(whole)}"
    return f"₹{_group(whole)}.{round((x - whole) * 100):02d}"


def _qty(x: float) -> str:
    return _group(int(x)) if x == int(x) else f"{x:,.2f}"


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
        "Hello {vendor} team, thank you for your quotation of {quote} per {unit} for {qty} {unit} of "
        "{item}. For this quantity we were looking at around {price} per {unit}. Could you please "
        "revisit your price?{pay}\n\nRegards,\n{sign}"),
    ("open", "buy", "hi"): (
        "नमस्कार {vendor} टीम, {item} ({qty} {unit}) के लिए {quote} प्रति {unit} का कोटेशन देने के लिए "
        "धन्यवाद। इस मात्रा के लिए हम लगभग {price} प्रति {unit} की उम्मीद कर रहे थे। क्या आप कृपया "
        "अपनी कीमत पर पुनर्विचार कर सकते हैं?{pay}\n\nधन्यवाद,\n{sign}"),
    ("open", "buy", "mr"): (
        "नमस्कार {vendor} टीम, {item} ({qty} {unit}) साठी {quote} प्रति {unit} दराने कोटेशन दिल्याबद्दल "
        "धन्यवाद. या प्रमाणासाठी आम्हाला साधारण {price} प्रति {unit} अपेक्षित होते. कृपया आपल्या "
        "किमतीचा पुनर्विचार कराल का?{pay}\n\nधन्यवाद,\n{sign}"),
    ("counter", "buy", "en"): (
        "Thanks for coming back to us. We can move to {price} per {unit}.{pay} Would that work for "
        "you?\n\nRegards,\n{sign}"),
    ("counter", "buy", "hi"): (
        "आपके जवाब के लिए धन्यवाद। हम {price} प्रति {unit} तक आ सकते हैं।{pay} क्या यह आपको मंज़ूर "
        "होगा?\n\nधन्यवाद,\n{sign}"),
    ("counter", "buy", "mr"): (
        "उत्तर दिल्याबद्दल धन्यवाद. आम्ही {price} प्रति {unit} पर्यंत येऊ शकतो.{pay} हे आपल्याला "
        "मान्य आहे का?\n\nधन्यवाद,\n{sign}"),
    ("close", "buy", "en"): (
        "Thank you. If you can do {price} per {unit}, we can go ahead with the order today.{pay}"
        "\n\nRegards,\n{sign}"),
    ("close", "buy", "hi"): (
        "धन्यवाद। अगर आप {price} प्रति {unit} कर दें तो हम आज ही ऑर्डर आगे बढ़ा सकते हैं।{pay}"
        "\n\nधन्यवाद,\n{sign}"),
    ("close", "buy", "mr"): (
        "धन्यवाद. जर आपण {price} प्रति {unit} केले तर आम्ही आजच ऑर्डर पुढे नेऊ शकतो.{pay}"
        "\n\nधन्यवाद,\n{sign}"),
    ("accept", "buy", "en"): (
        "Alright, {price} per {unit} is fine with us.{pay} Thank you for working with us on this."
        "\n\nRegards,\n{sign}"),
    ("accept", "buy", "hi"): (
        "ठीक है, {price} प्रति {unit} हमें मंज़ूर है।{pay} इसमें सहयोग के लिए धन्यवाद।"
        "\n\nधन्यवाद,\n{sign}"),
    ("accept", "buy", "mr"): (
        "ठीक आहे, {price} प्रति {unit} आम्हाला मान्य आहे.{pay} सहकार्याबद्दल धन्यवाद."
        "\n\nधन्यवाद,\n{sign}"),
    ("open", "sell", "en"): (
        "Hello {vendor} team, thank you for your bid of {quote} per {unit} for {qty} {unit} of "
        "{item}. Going by current market levels we were expecting around {price} per {unit}. Could "
        "you please revisit your bid?{pay}\n\nRegards,\n{sign}"),
    ("open", "sell", "hi"): (
        "नमस्कार {vendor} टीम, {item} ({qty} {unit}) के लिए {quote} प्रति {unit} की बोली के लिए "
        "धन्यवाद। मौजूदा बाज़ार भाव को देखते हुए हम लगभग {price} प्रति {unit} की उम्मीद कर रहे थे। "
        "क्या आप अपनी बोली पर पुनर्विचार कर सकते हैं?{pay}\n\nधन्यवाद,\n{sign}"),
    ("open", "sell", "mr"): (
        "नमस्कार {vendor} टीम, {item} ({qty} {unit}) साठी {quote} प्रति {unit} बोली दिल्याबद्दल "
        "धन्यवाद. सध्याच्या बाजारभावानुसार आम्हाला साधारण {price} प्रति {unit} अपेक्षित होते. कृपया "
        "आपल्या बोलीचा पुनर्विचार कराल का?{pay}\n\nधन्यवाद,\n{sign}"),
    ("counter", "sell", "en"): (
        "Thanks for the revised bid. We can come down to {price} per {unit}.{pay} Would that work "
        "for you?\n\nRegards,\n{sign}"),
    ("counter", "sell", "hi"): (
        "संशोधित बोली के लिए धन्यवाद। हम {price} प्रति {unit} तक आ सकते हैं।{pay} क्या यह आपको "
        "मंज़ूर होगा?\n\nधन्यवाद,\n{sign}"),
    ("counter", "sell", "mr"): (
        "सुधारित बोलीबद्दल धन्यवाद. आम्ही {price} प्रति {unit} पर्यंत खाली येऊ शकतो.{pay} हे "
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
        "ठीक है, {price} प्रति {unit} हमें मंज़ूर है।{pay} धन्यवाद।\n\nधन्यवाद,\n{sign}"),
    ("accept", "sell", "mr"): (
        "ठीक आहे, {price} प्रति {unit} आम्हाला मान्य आहे.{pay} धन्यवाद.\n\nधन्यवाद,\n{sign}"),
}

# (kind, event direction, language). In a buy event the vendor sells; in a sell event the vendor buys.
_VENDOR: dict[tuple[str, str, str], str] = {
    ("counter", "buy", "en"): "Thanks for the feedback. For this quantity the best I can do is {price} per {unit}.",
    ("counter", "buy", "hi"): "फीडबैक के लिए धन्यवाद। इस मात्रा के लिए मैं {price} प्रति {unit} तक कर सकता हूँ।",
    ("counter", "buy", "mr"): "अभिप्रायाबद्दल धन्यवाद. या प्रमाणासाठी मी {price} प्रति {unit} पर्यंत करू शकतो.",
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


def _short(vendor_name: str) -> str:
    return vendor_name.split()[0] if vendor_name else "there"


def our_message(
    kind: str, *, direction: str, lang: str, vendor_name: str, item: str, qty: float, unit: str,
    quote: float, price: float, payment_ask: Optional[str] = None, agreed_payment: Optional[str] = None,
    signature: str = SIGNATURE,
) -> str:
    """The text we send. `quote` is the vendor's current price; `price` is what we propose."""
    template = _OURS[(kind, direction, lang)]
    pay = payment_phrase(lang, direction, payment_ask) if kind != "accept" else _agreed_payment(lang, agreed_payment)
    return template.format(
        vendor=_short(vendor_name), item=item, qty=_qty(qty), unit=_UNIT[lang].get(unit, unit),
        quote=money(quote), price=money(price), pay=pay, sign=signature)


def vendor_message(
    kind: str, *, direction: str, lang: str, price: float, unit: str, payment: Optional[str] = None,
) -> str:
    """The simulated vendor's reply text."""
    template = _VENDOR[(kind, direction, lang)]
    return template.format(
        price=money(price), unit=_UNIT[lang].get(unit, unit),
        pay=_agreed_payment(lang, payment) if payment else "")
