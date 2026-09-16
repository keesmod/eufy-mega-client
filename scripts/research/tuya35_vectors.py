"""Reproduce the Tuya LAN 3.5 frame and session-key vectors with tinytuya 1.20.0 (MIT).

Offline oracle for docs/MOWER_TRANSPORT_PROVENANCE.md. It performs no network I/O and
is not part of the package or CI. Install ``tinytuya==1.20.0`` and ``cryptography`` in a
virtual environment, then run it without arguments to print the reference vectors that
test/mower-local-transport.test.mjs asserts. Pass a JSON object with ``query``, ``start``
and ``finish`` hex frames produced by the TypeScript codec to decode them with tinytuya.
All inputs are synthetic. No device key or identifier is involved.
"""

import hmac
import json
import sys
from hashlib import sha256

from tinytuya.core import header as H
from tinytuya.core.crypto_helper import AESCipher
from tinytuya.core.message_helper import TuyaMessage, pack_message, unpack_message

KEY = b"synthetic-key-16"
NONCE = bytes.fromhex("000102030405060708090a0b")
CLIENT_NONCE = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
DEVICE_NONCE = bytes.fromhex("101112131415161718191a1b1c1d1e1f")


def client_frame(sequence, command, payload):
    message = TuyaMessage(sequence, command, None, payload, 0, True, H.PREFIX_6699_VALUE, NONCE)
    return pack_message(message, hmac_key=KEY).hex()


def main():
    finish = hmac.new(KEY, DEVICE_NONCE, sha256).digest()
    mixed = bytes(a ^ b for a, b in zip(CLIENT_NONCE, DEVICE_NONCE))
    out = {
        "query": client_frame(7, 0x10, b"{}"),
        "start": client_frame(1, 0x03, CLIENT_NONCE),
        "finishPayload": finish.hex(),
        "finish": client_frame(2, 0x05, finish),
        "sessionKey": AESCipher(KEY)
        .encrypt(mixed, use_base64=False, pad=False, iv=CLIENT_NONCE[:12])[12:28]
        .hex(),
        "deviceReply": pack_message(
            TuyaMessage(
                9, 0x10, 0, b'{"dps":{"1":true},"devId":"SYN"}', 0, True, H.PREFIX_6699_VALUE, NONCE
            ),
            hmac_key=KEY,
        ).hex(),
    }
    if len(sys.argv) > 1:
        frames = json.loads(sys.argv[1])
        for name in ("query", "start", "finish"):
            message = unpack_message(bytes.fromhex(frames[name]), hmac_key=KEY, no_retcode=True)
            out["decoded_" + name] = {
                "seqno": message.seqno,
                "cmd": message.cmd,
                "crc_good": message.crc_good,
                "payload": message.payload.hex(),
            }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
