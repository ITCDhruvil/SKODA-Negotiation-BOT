"""Wording for the harder tactics (terms trade, leverage, split, bluff, hold), merged into app.negotiation.messages.

Placeholders are the same as in messages: {price} {unit} {pay}. Nothing here names a limit, a target, another
vendor's price or software; "other offers" is only used when the engine has checked another quote exists.
Main wording is variant 0; ALT holds the extra English variants.
"""
from __future__ import annotations

OURS: dict[tuple[str, str, str], str] = {
    ("crawl", "buy", "en"): "Thank you for moving, but steps this small do not really help us. We need a more meaningful number to take this forward. We are at {price} per {unit} for now.{pay}",
    ("crawl", "buy", "hi"): "आगे बढ़ने के लिए धन्यवाद, लेकिन इतने छोटे कदमों से हमें मदद नहीं मिलती। बात आगे ले जाने के लिए हमें एक सार्थक संख्या चाहिए। हम अभी {price} प्रति {unit} पर हैं।{pay}",
    ("crawl", "buy", "mr"): "पुढे आल्याबद्दल धन्यवाद, पण इतक्या लहान पावलांनी आम्हाला मदत होत नाही. पुढे जाण्यासाठी आम्हाला अर्थपूर्ण आकडा हवा. आम्ही सध्या {price} प्रति {unit} वर आहोत.{pay}",
    ("crawl", "sell", "en"): "Thank you for moving, but steps this small do not really help us. We need a more meaningful rate to take this forward. We are at {price} per {unit} for now.{pay}",
    ("crawl", "sell", "hi"): "आगे बढ़ने के लिए धन्यवाद, लेकिन इतने छोटे कदमों से हमें मदद नहीं मिलती। बात आगे ले जाने के लिए हमें एक सार्थक भाव चाहिए। हम अभी {price} प्रति {unit} पर हैं।{pay}",
    ("crawl", "sell", "mr"): "पुढे आल्याबद्दल धन्यवाद, पण इतक्या लहान पावलांनी आम्हाला मदत होत नाही. पुढे जाण्यासाठी आम्हाला अर्थपूर्ण भाव हवा. आम्ही सध्या {price} प्रति {unit} वर आहोत.{pay}",
    ("trade", "buy", "en"): "I understand price is tight for you, so let us look at terms instead. We can stay at {price} per {unit} if the payment terms can be eased.{pay}",
    ("trade", "buy", "hi"): "मैं समझता हूँ कि कीमत पर आपके लिए गुंजाइश कम है, तो चलिए शर्तों पर बात करते हैं। अगर भुगतान की शर्तें आसान हो जाएँ तो हम {price} प्रति {unit} पर बने रह सकते हैं।{pay}",
    ("trade", "buy", "mr"): "किंमतीवर तुमच्यासाठी जागा कमी आहे हे मला समजते, त्यामुळे अटींवर बोलूया. पेमेंटच्या अटी सोप्या झाल्या तर आम्ही {price} प्रति {unit} वर राहू शकतो.{pay}",
    ("trade", "sell", "en"): "I understand the rate is tight for you, so let us look at terms instead. We can stay at {price} per {unit} if the payment can come sooner.{pay}",
    ("trade", "sell", "hi"): "मैं समझता हूँ कि भाव पर आपके लिए गुंजाइश कम है, तो चलिए शर्तों पर बात करते हैं। अगर भुगतान जल्दी हो जाए तो हम {price} प्रति {unit} पर बने रह सकते हैं।{pay}",
    ("trade", "sell", "mr"): "भावावर तुमच्यासाठी जागा कमी आहे हे मला समजते, त्यामुळे अटींवर बोलूया. पेमेंट लवकर झाले तर आम्ही {price} प्रति {unit} वर राहू शकतो.{pay}",
    ("leverage", "buy", "en"): "We have other offers that are closer to what we expected, but we would prefer to continue with you. Could you do {price} per {unit}?{pay}",
    ("leverage", "buy", "hi"): "हमारे पास कुछ और प्रस्ताव हैं जो हमारी अपेक्षा के ज़्यादा करीब हैं, लेकिन हम आपके साथ ही आगे बढ़ना चाहेंगे। क्या आप {price} प्रति {unit} कर सकते हैं?{pay}",
    ("leverage", "buy", "mr"): "आमच्याकडे आणखी काही प्रस्ताव आहेत जे आमच्या अपेक्षेच्या जवळ आहेत, पण आम्हाला तुमच्यासोबतच पुढे जायला आवडेल. तुम्ही {price} प्रति {unit} करू शकाल का?{pay}",
    ("leverage", "sell", "en"): "We have other interest in the lot that is closer to what we expected, but we would prefer to work with you. Could you do {price} per {unit}?{pay}",
    ("leverage", "sell", "hi"): "इस लॉट के लिए हमारे पास और भी रुचि है जो हमारी अपेक्षा के करीब है, लेकिन हम आपके साथ काम करना पसंद करेंगे। क्या आप {price} प्रति {unit} कर सकते हैं?{pay}",
    ("leverage", "sell", "mr"): "या लॉटसाठी आमच्याकडे आणखी काही रस आहे जो आमच्या अपेक्षेच्या जवळ आहे, पण आम्हाला तुमच्यासोबत काम करायला आवडेल. तुम्ही {price} प्रति {unit} करू शकाल का?{pay}",
    ("split", "buy", "en"): "We are not far apart. Let us meet in the middle at {price} per {unit} and close this today.{pay}",
    ("split", "buy", "hi"): "हम ज़्यादा दूर नहीं हैं। चलिए बीच में {price} प्रति {unit} पर मिलते हैं और आज ही इसे पक्का करते हैं।{pay}",
    ("split", "buy", "mr"): "आपण फार दूर नाही. चला मधोमध {price} प्रति {unit} वर भेटूया आणि आजच हे पक्के करूया.{pay}",
    ("split", "sell", "en"): "We are not far apart. Let us meet in the middle at {price} per {unit} and arrange the pickup this week.{pay}",
    ("split", "sell", "hi"): "हम ज़्यादा दूर नहीं हैं। चलिए बीच में {price} प्रति {unit} पर मिलते हैं और इसी हफ़्ते माल उठवाते हैं।{pay}",
    ("split", "sell", "mr"): "आपण फार दूर नाही. चला मधोमध {price} प्रति {unit} वर भेटूया आणि याच आठवड्यात माल उचलूया.{pay}",
    ("bluff", "buy", "en"): "I appreciate you being clear, but I feel there is still some room between us. Could you take one more look at {price} per {unit}?{pay}",
    ("bluff", "buy", "hi"): "आपकी स्पष्टता के लिए धन्यवाद, लेकिन मुझे लगता है कि अभी भी हमारे बीच कुछ गुंजाइश है। क्या आप {price} प्रति {unit} पर एक बार और विचार करेंगे?{pay}",
    ("bluff", "buy", "mr"): "तुमच्या स्पष्टतेबद्दल धन्यवाद, पण आपल्यात अजून थोडी जागा आहे असे वाटते. तुम्ही {price} प्रति {unit} वर आणखी एकदा विचार कराल का?{pay}",
    ("bluff", "sell", "en"): "I appreciate you being clear, but I feel there is still some room between us. Could you take one more look at {price} per {unit}?{pay}",
    ("bluff", "sell", "hi"): "आपकी स्पष्टता के लिए धन्यवाद, लेकिन मुझे लगता है कि अभी भी हमारे बीच कुछ गुंजाइश है। क्या आप {price} प्रति {unit} पर एक बार और विचार करेंगे?{pay}",
    ("bluff", "sell", "mr"): "तुमच्या स्पष्टतेबद्दल धन्यवाद, पण आपल्यात अजून थोडी जागा आहे असे वाटते. तुम्ही {price} प्रति {unit} वर आणखी एकदा विचार कराल का?{pay}",
    ("hold", "buy", "en"): "We are at {price} per {unit} and this is where we need to stay on price. Please see if you can come closer to us.{pay}",
    ("hold", "buy", "hi"): "हम {price} प्रति {unit} पर हैं और कीमत में हमें यहीं रहना होगा। कृपया देखिए कि आप हमारे थोड़ा करीब आ सकते हैं।{pay}",
    ("hold", "buy", "mr"): "आम्ही {price} प्रति {unit} वर आहोत आणि किंमतीत आम्हाला इथेच राहावे लागेल. कृपया थोडे आमच्या जवळ येता येईल का ते पहा.{pay}",
    ("hold", "sell", "en"): "We are at {price} per {unit} and this is where we need to stay on price. Please see if you can come closer to us.{pay}",
    ("hold", "sell", "hi"): "हम {price} प्रति {unit} पर हैं और भाव में हमें यहीं रहना होगा। कृपया देखिए कि आप हमारे थोड़ा करीब आ सकते हैं।{pay}",
    ("hold", "sell", "mr"): "आम्ही {price} प्रति {unit} वर आहोत आणि भावात आम्हाला इथेच राहावे लागेल. कृपया थोडे आमच्या जवळ येता येईल का ते पहा.{pay}",
}

ALT: dict[tuple[str, str], list[str]] = {
    ("crawl", "buy"): [
        "I see you are moving a little each time, but that will not get us there. A real step from your side would let me take this to my manager. We stay at {price} per {unit}.{pay}",
    ],
    ("crawl", "sell"): [
        "I see you are moving a little each time, but that will not get us there. A real step from your side would let me take this to my manager. We stay at {price} per {unit}.{pay}",
    ],
    ("trade", "buy"): [
        "Let us try a different angle. We can hold at {price} per {unit} if the payment terms can be eased.{pay}",
        "Maybe we can meet on terms rather than price. We stay at {price} per {unit}.{pay}",
    ],
    ("trade", "sell"): [
        "Let us try a different angle. We can hold at {price} per {unit} if the payment can come sooner.{pay}",
        "Maybe we can meet on terms rather than rate. We stay at {price} per {unit}.{pay}",
    ],
    ("leverage", "buy"): [
        "To be open with you, we are comparing a few offers and some are closer to our expectation. We would still like to work with you at {price} per {unit}.{pay}",
        "Other quotes are nearer to what we planned, but we value working with you. Can you come to {price} per {unit}?{pay}",
    ],
    ("leverage", "sell"): [
        "To be open with you, there is other interest in the lot nearer to our expectation. We would still like to work with you at {price} per {unit}.{pay}",
        "Other interest is nearer to what we planned, but we value working with you. Can you come to {price} per {unit}?{pay}",
    ],
    ("split", "buy"): [
        "I think we can close this. If we both give a little, {price} per {unit} should work for everyone.{pay}",
        "Let us settle it halfway: {price} per {unit}, and I can confirm right away.{pay}",
    ],
    ("split", "sell"): [
        "I think we can close this. If we both give a little, {price} per {unit} should work for everyone.{pay}",
        "Let us settle it halfway: {price} per {unit}, and the lot is yours this week.{pay}",
    ],
    ("bluff", "buy"): [
        "Thanks for the straight answer. Before we call it final, could you reconsider {price} per {unit}?{pay}",
        "I hear you. Still, I think there is a little room. Would {price} per {unit} be possible?{pay}",
    ],
    ("bluff", "sell"): [
        "Thanks for the straight answer. Before we call it final, could you reconsider {price} per {unit}?{pay}",
        "I hear you. Still, I think there is a little room. Would {price} per {unit} be possible?{pay}",
    ],
    ("hold", "buy"): [
        "I have moved as far as I can on price for now, {price} per {unit}. Could you meet us a bit closer?{pay}",
        "{price} per {unit} is where we are. A small step from your side would help us close.{pay}",
    ],
    ("hold", "sell"): [
        "I have moved as far as I can on the rate for now, {price} per {unit}. Could you meet us a bit closer?{pay}",
        "{price} per {unit} is where we are. A small step from your side would help us close.{pay}",
    ],
}
