#!/usr/bin/env python3
"""
Widestring Prime — Premium Pure Python CENC DASH/MPD Decryptor
================================================================
Zero subprocess per segment. Pure Python AES-128 decryption.
Supports: ClearKey + Widevine L3
Schemes: cenc (AES-128-CTR), cbcs (AES-128-CBC pattern)

Dependencies:
    pip install requests lxml cryptography
    pip install pywidevine   # Widevine only
    apt install ffmpeg       # muxing only
"""

import argparse
import base64
import json
import logging
import os
import re
import signal
import struct
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from urllib.parse import urljoin

import requests
from lxml import etree

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False

try:
    from pywidevine.cdm import Cdm
    from pywidevine.device import Device
    from pywidevine.pssh import PSSH
    HAS_WIDEVINE = True
except ImportError:
    HAS_WIDEVINE = False

logger = logging.getLogger("widestring")

NS_MP = "urn:mpeg:dash:schema:mpd:2011"
NS_CENC = "urn:mpeg:cenc:2013"
WV_SYSTEM_ID = "edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"

CONTAINER_TYPES = {
    b'moov', b'trak', b'mdia', b'minf', b'stbl', b'stsd',
    b'sinf', b'schi', b'moof', b'traf', b'edts', b'udta', b'mvex',
}
VISUAL_SE = {b'encv', b'avc1', b'avc3', b'hvc1', b'hev1', b'av01'}
AUDIO_SE = {b'enca', b'mp4a', b'ac-3', b'ec-3', b'opus'}
SAMPLE_ENTRIES = VISUAL_SE | AUDIO_SE


# ═══════════════════════════════════════════════════
# ISO BMFF Box Utilities
# ═══════════════════════════════════════════════════

def iter_boxes(data: bytes, start: int = 0, end: int = -1):
    """Yield (type_bytes, offset, size, header_size) for each box."""
    if end == -1:
        end = len(data)
    pos = start
    while pos + 8 <= end:
        size = struct.unpack('>I', data[pos:pos+4])[0]
        btype = data[pos+4:pos+8]
        hdr = 8
        if size == 1:
            if pos + 16 > end:
                break
            size = struct.unpack('>Q', data[pos+8:pos+16])[0]
            hdr = 16
        elif size == 0:
            size = end - pos
        if size < 8 or pos + size > end:
            break
        yield (btype, pos, size, hdr)
        pos += size


def child_start_of(btype: bytes, offset: int, hdr: int) -> int:
    """Get child content start offset for container/sample-entry boxes."""
    if btype == b'stsd':
        return offset + 16          # fullbox(4) + entry_count(4) after header
    if btype in VISUAL_SE:
        return offset + 86          # VisualSampleEntry fixed fields
    if btype in AUDIO_SE:
        return offset + 36          # AudioSampleEntry fixed fields
    return offset + hdr             # plain container


def find_all_boxes(data: bytes, target: bytes, start: int = 0, end: int = -1) -> list:
    """Recursively find all boxes of target type."""
    if end == -1:
        end = len(data)
    results = []
    for btype, offset, size, hdr in iter_boxes(data, start, end):
        if btype == target:
            results.append((offset, size, hdr))
        if btype in CONTAINER_TYPES or btype in SAMPLE_ENTRIES:
            cs = child_start_of(btype, offset, hdr)
            results.extend(find_all_boxes(data, target, cs, offset + size))
    return results


def find_ancestor_chain(data: bytes, target_offset: int, start: int = 0, end: int = -1) -> list:
    """Find chain of enclosing boxes for target_offset."""
    if end == -1:
        end = len(data)
    pos = start
    while pos + 8 <= end:
        size = struct.unpack('>I', data[pos:pos+4])[0]
        btype = data[pos+4:pos+8]
        hdr = 8
        if size == 1:
            size = struct.unpack('>Q', data[pos+8:pos+16])[0]
            hdr = 16
        elif size == 0:
            size = end - pos
        if size < 8:
            break
        box_end = pos + size
        if pos <= target_offset < box_end:
            chain = [(pos, size, btype)]
            if btype in CONTAINER_TYPES or btype in SAMPLE_ENTRIES:
                cs = child_start_of(btype, pos, hdr)
                chain.extend(find_ancestor_chain(data, target_offset, cs, box_end))
            return chain
        pos += size
    return []


# ═══════════════════════════════════════════════════
# Box Parsers
# ═══════════════════════════════════════════════════

def parse_tenc(data: bytes, offset: int) -> dict:
    """Parse TrackEncryptionBox."""
    hdr = 8
    version = data[offset + hdr]
    flags = int.from_bytes(data[offset+hdr+1:offset+hdr+4], 'big')
    pos = offset + hdr + 4
    is_protected = data[pos]
    per_sample_iv_size = data[pos + 1]
    kid = data[pos + 2:pos + 18]
    pos += 18

    crypt_block = skip_block = 0
    constant_iv = None

    if version >= 1:
        if flags & 0x000001:
            crypt_block = data[pos] >> 4
            skip_block = data[pos] & 0x0F
            pos += 1
        if flags & 0x000002:
            iv_len = data[pos]
            pos += 1
            constant_iv = data[pos:pos + iv_len]

    return {
        'is_protected': is_protected,
        'per_sample_iv_size': per_sample_iv_size,
        'kid': kid.hex(),
        'crypt_block': crypt_block,
        'skip_block': skip_block,
        'constant_iv': bytes(constant_iv) if constant_iv else None,
    }


def parse_schm(data: bytes, offset: int) -> Optional[str]:
    """Parse SchemeTypeBox → returns scheme like 'cenc' or 'cbcs'."""
    results = find_all_boxes(data, b'schm')
    if not results:
        return None
    off, sz, hdr = results[0]
    version = data[off + hdr]
    flags_val = int.from_bytes(data[off+hdr+1:off+hdr+4], 'big')
    pos = off + hdr + 4
    scheme = data[pos:pos + 4].decode('ascii', errors='replace')
    return scheme


def parse_senc(data: bytes, offset: int) -> dict:
    """Parse SampleEncryptionBox."""
    hdr = 8
    version = data[offset + hdr]
    flags = int.from_bytes(data[offset+hdr+1:offset+hdr+4], 'big')
    pos = offset + hdr + 4
    sample_count = struct.unpack('>I', data[pos:pos+4])[0]
    pos += 4

    samples = []
    for _ in range(sample_count):
        iv = None
        if version == 0:
            iv = data[pos:pos + 16]
            pos += 16
        subsamples = None
        if flags & 0x000001:
            sub_count = struct.unpack('>H', data[pos:pos+2])[0]
            pos += 2
            subsamples = []
            for _ in range(sub_count):
                clear_b = struct.unpack('>H', data[pos:pos+2])[0]
                pos += 2
                enc_b = struct.unpack('>I', data[pos:pos+4])[0]
                pos += 4
                subsamples.append((clear_b, enc_b))
        samples.append({'iv': bytes(iv) if iv else None, 'subsamples': subsamples})

    return {'version': version, 'flags': flags, 'sample_count': sample_count, 'samples': samples}


def parse_trun(data: bytes, offset: int) -> dict:
    """Parse TrackRunBox."""
    hdr = 8
    version = data[offset + hdr]
    flags = int.from_bytes(data[offset+hdr+1:offset+hdr+4], 'big')
    pos = offset + hdr + 4
    sample_count = struct.unpack('>I', data[pos:pos+4])[0]
    pos += 4

    data_offset = None
    if flags & 0x000001:
        data_offset = struct.unpack('>i', data[pos:pos+4])[0]
        pos += 4

    first_sample_flags = None
    if flags & 0x000004:
        first_sample_flags = struct.unpack('>I', data[pos:pos+4])[0]
        pos += 4

    sample_sizes = []
    for _ in range(sample_count):
        if flags & 0x000100:
            pos += 4  # duration
        if flags & 0x000200:
            sample_sizes.append(struct.unpack('>I', data[pos:pos+4])[0])
            pos += 4
        if flags & 0x000400:
            pos += 4  # flags
        if flags & 0x000800:
            pos += 4  # composition offset

    return {
        'offset': offset, 'flags': flags, 'sample_count': sample_count,
        'data_offset': data_offset, 'sample_sizes': sample_sizes,
    }


def parse_tfhd(data: bytes, offset: int) -> dict:
    """Parse TrackFragmentHeaderBox."""
    hdr = 8
    flags = int.from_bytes(data[offset+hdr+1:offset+hdr+4], 'big')
    pos = offset + hdr + 4
    track_id = struct.unpack('>I', data[pos:pos+4])[0]
    pos += 4

    base_data_offset = None
    if flags & 0x000001:
        base_data_offset = struct.unpack('>Q', data[pos:pos+8])[0]
        pos += 8

    default_sample_size = None
    if flags & 0x000010:
        default_sample_size = struct.unpack('>I', data[pos:pos+4])[0]
        pos += 4

    return {
        'flags': flags, 'track_id': track_id,
        'base_data_offset': base_data_offset,
        'default_sample_size': default_sample_size,
        'has_default_base_moof': bool(flags & 0x020000),
    }


# ═══════════════════════════════════════════════════
# AES Crypto
# ═══════════════════════════════════════════════════

def aes_ctr_decrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
    """AES-128-CTR decrypt. IV = initial 128-bit counter block."""
    cipher = Cipher(algorithms.AES(key), modes.CTR(iv), backend=default_backend())
    dec = cipher.decryptor()
    return dec.update(data) + dec.finalize()


def aes_cbc_decrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
    """AES-128-CBC decrypt."""
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    dec = cipher.decryptor()
    return dec.update(data) + dec.finalize()


# ═══════════════════════════════════════════════════
# CENC Fragment Decryptor
# ═══════════════════════════════════════════════════

class CENCDecryptor:
    """Pure Python CENC decryption for fMP4 fragments."""

    def __init__(self, key: bytes, scheme: str = 'cenc',
                 cbcs_iv: bytes = None, crypt_block: int = 0, skip_block: int = 0):
        self.key = key
        self.scheme = scheme
        self.cbcs_iv = cbcs_iv or b'\x00' * 16
        self.crypt_block = crypt_block
        self.skip_block = skip_block

    def decrypt_fragment(self, data: bytes) -> bytes:
        """Decrypt a fMP4 fragment (moof+mdat). Returns cleaned fragment."""
        # Find moof
        moof_info = None
        for btype, off, sz, hdr in iter_boxes(data):
            if btype == b'moof':
                moof_info = (off, sz, hdr)
                break

        if not moof_info:
            return data

        moof_offset, moof_size, moof_hdr = moof_info

        # Find traf inside moof
        traf_info = None
        for btype, off, sz, hdr in iter_boxes(data, moof_offset + moof_hdr, moof_offset + moof_size):
            if btype == b'traf':
                traf_info = (off, sz, hdr)
                break

        if not traf_info:
            return data

        traf_offset, traf_size, traf_hdr = traf_info
        traf_start = traf_offset + traf_hdr
        traf_end = traf_offset + traf_size

        # Parse boxes inside traf
        senc_info = None
        trun_info = None
        tfhd_info = None

        for btype, off, sz, hdr in iter_boxes(data, traf_start, traf_end):
            if btype == b'senc':
                senc_info = parse_senc(data, off)
            elif btype == b'trun':
                trun_info = parse_trun(data, off)
            elif btype == b'tfhd':
                tfhd_info = parse_tfhd(data, off)

        if not senc_info or not senc_info['samples']:
            return data  # Not encrypted

        if not trun_info:
            logger.warning("No trun in traf, skipping decryption")
            return data

        # Calculate sample positions
        base = moof_offset
        if tfhd_info and tfhd_info['base_data_offset'] is not None:
            bdo = tfhd_info['base_data_offset']
            if bdo < len(data):
                base = bdo

        data_offset = trun_info['data_offset'] or 0
        first_sample = base + data_offset

        # Get sample sizes
        if trun_info['sample_sizes']:
            sample_sizes = trun_info['sample_sizes']
        elif tfhd_info and tfhd_info['default_sample_size']:
            sample_sizes = [tfhd_info['default_sample_size']] * trun_info['sample_count']
        else:
            logger.warning("No sample sizes available")
            return data

        # Decrypt samples in-place
        result = bytearray(data)
        pos = first_sample

        for i, sinfo in enumerate(senc_info['samples']):
            if i >= len(sample_sizes):
                break
            ssize = sample_sizes[i]
            iv = sinfo['iv']
            subs = sinfo['subsamples']

            if iv is None:
                iv = self.cbcs_iv  # cbcs constant IV

            if subs:
                sub_pos = pos
                for clear_b, enc_b in subs:
                    sub_pos += clear_b
                    if enc_b > 0:
                        enc_data = bytes(result[sub_pos:sub_pos + enc_b])
                        if self.scheme == 'cbcs':
                            dec = self._decrypt_cbcs_pattern(enc_data, iv)
                        else:
                            dec = aes_ctr_decrypt(self.key, iv, enc_data)
                        result[sub_pos:sub_pos + enc_b] = dec
                        sub_pos += enc_b
            else:
                sample_data = bytes(result[pos:pos + ssize])
                if self.scheme == 'cbcs':
                    dec = self._decrypt_cbcs_pattern(sample_data, iv)
                else:
                    dec = aes_ctr_decrypt(self.key, iv, sample_data)
                result[pos:pos + ssize] = dec

            pos += ssize

        # Rebuild moof without encryption boxes, adjust trun data_offset
        return self._rebuild_fragment(bytes(result), moof_offset, moof_size, moof_hdr, traf_start, traf_end)

    def _decrypt_cbcs_pattern(self, data: bytes, iv: bytes) -> bytes:
        """AES-128-CBC pattern decryption (cbcs scheme)."""
        bs = 16
        total_blocks = len(data) // bs
        pattern_len = self.crypt_block + self.skip_block
        if pattern_len == 0 or self.crypt_block == 0:
            return data

        result = bytearray()
        pos = 0
        cur_iv = iv

        for blk_idx in range(total_blocks):
            pat_pos = blk_idx % pattern_len
            block = data[pos:pos + bs]

            if pat_pos < self.crypt_block:
                if pat_pos == 0:
                    cur_iv = iv  # Reset chain at start of each encrypted group
                dec = aes_cbc_decrypt(self.key, cur_iv, block)
                result.extend(dec)
                cur_iv = block  # CBC chaining within group
            else:
                result.extend(block)

            pos += bs

        result.extend(data[pos:])  # trailing partial block
        return bytes(result)

    def _rebuild_fragment(self, data: bytes, moof_off: int, moof_size: int,
                          moof_hdr: int, traf_start: int, traf_end: int) -> bytes:
        """Rebuild fragment: remove senc/saiz/saio from traf, fix sizes and data_offset."""
        REMOVE = {b'senc', b'saiz', b'saio'}
        removed_size = 0

        # Build new traf children
        new_traf_children = bytearray()
        for btype, off, sz, hdr in iter_boxes(data, traf_start, traf_end):
            if btype in REMOVE:
                removed_size += sz
                continue
            if btype == b'trun':
                box_bytes = bytearray(data[off:off + sz])
                flags = int.from_bytes(box_bytes[9:12], 'big')
                if flags & 0x000001 and removed_size > 0:
                    old_do = struct.unpack('>i', bytes(box_bytes[16:20]))[0]
                    new_do = old_do - removed_size
                    box_bytes[16:20] = struct.pack('>i', new_do)
                new_traf_children.extend(bytes(box_bytes))
            else:
                new_traf_children.extend(data[off:off + sz])

        new_traf = struct.pack('>I', 8 + len(new_traf_children)) + b'traf' + bytes(new_traf_children)

        # Build new moof
        new_moof_children = bytearray()
        for btype, off, sz, hdr in iter_boxes(data, moof_off + moof_hdr, moof_off + moof_size):
            if btype == b'traf':
                new_moof_children.extend(new_traf)
            else:
                new_moof_children.extend(data[off:off + sz])

        new_moof = struct.pack('>I', 8 + len(new_moof_children)) + b'moof' + bytes(new_moof_children)

        # Assemble: before moof + new moof + after moof (mdat with decrypted data)
        before = data[:moof_off]
        after = data[moof_off + moof_size:]
        return before + new_moof + after


# ═══════════════════════════════════════════════════
# Init Segment Cleaner
# ═══════════════════════════════════════════════════

def clean_init_segment(data: bytes) -> bytes:
    """Remove CENC encryption from init segment: remove sinf, rename sample entries."""
    # Process one sinf at a time, re-searching after each modification
    result = data
    while True:
        sinf_boxes = find_all_boxes(result, b'sinf')
        if not sinf_boxes:
            break
        sinf_off, sinf_size, _ = sinf_boxes[0]
        result = _remove_sinf(result, sinf_off, sinf_size)
    return result


def _remove_sinf(data: bytes, sinf_off: int, sinf_size: int) -> bytes:
    """Remove one sinf box, rename sample entry, fix ancestor sizes."""
    # Find ancestor chain
    ancestors = find_ancestor_chain(data, sinf_off)

    # Find the sample entry in the chain
    se_type = None
    se_offset = None
    for a_off, a_size, a_type in ancestors:
        if a_type in (b'encv', b'enca'):
            se_offset = a_off
            se_type = a_type
            break

    # Determine new sample entry type
    new_type = None
    if se_type == b'encv':
        if find_all_boxes(data, b'avcC', se_offset + 8, se_offset + 
                          next((s for o, s, t in ancestors if t == b'encv'), len(data))):
            new_type = b'avc1'
        elif find_all_boxes(data, b'hvcC', se_offset + 8, se_offset +
                            next((s for o, s, t in ancestors if t == b'encv'), len(data))):
            new_type = b'hvc1'
    elif se_type == b'enca':
        new_type = b'mp4a'

    # Build new data without sinf
    result = bytearray(data[:sinf_off] + data[sinf_off + sinf_size:])

    # Rename sample entry
    if new_type and se_offset is not None:
        result[se_offset + 4:se_offset + 8] = new_type

    # Fix ancestor sizes (all are before sinf, offsets unaffected)
    for a_off, a_size, a_type in ancestors:
        old_sz = struct.unpack('>I', result[a_off:a_off + 4])[0]
        new_sz = old_sz - sinf_size
        result[a_off:a_off + 4] = struct.pack('>I', new_sz)

    return bytes(result)


def get_scheme_info(init_data: bytes) -> dict:
    """Extract scheme info from init segment."""
    scheme = parse_schm(init_data, 0) or 'cenc'

    tenc_boxes = find_all_boxes(init_data, b'tenc')
    tenc = None
    if tenc_boxes:
        tenc = parse_tenc(init_data, tenc_boxes[0][0])

    if tenc:
        if tenc['per_sample_iv_size'] == 0 and scheme == 'cenc':
            scheme = 'cbcs'
        elif tenc['per_sample_iv_size'] == 16 and scheme not in ('cenc', 'cbcs'):
            scheme = 'cenc'

    # Extract PSSH
    pssh_list = []
    for pssh_off, pssh_sz, pssh_hdr in find_all_boxes(init_data, b'pssh'):
        pssh_list.append(init_data[pssh_off:pssh_off + pssh_sz])

    return {
        'scheme': scheme,
        'tenc': tenc,
        'pssh': pssh_list,
        'kid': tenc['kid'] if tenc else None,
    }


def extract_pssh_from_mpd(mpd_data: bytes) -> bytes:
    """Extract Widevine PSSH from MPD ContentProtection."""
    for cp in mpd_data.iter if hasattr(mpd_data, 'iter') else []:
        pass
    # This is handled in MPDParser instead
    return b''


# ═══════════════════════════════════════════════════
# Data Classes
# ═══════════════════════════════════════════════════

@dataclass
class Segment:
    number: int
    url: str
    time: int = 0
    duration: int = 0


@dataclass
class Representation:
    id: str
    bandwidth: int
    width: int = 0
    height: int = 0
    codecs: str = ""
    mime_type: str = ""
    content_type: str = ""
    lang: str = ""
    init_url: str = ""
    media_template: str = ""
    timescale: int = 1
    start_number: int = 1
    duration: int = 0
    segments: list = field(default_factory=list)
    base_url: str = ""


@dataclass
class MPDData:
    type: str = "static"
    minimum_update_period: float = 0.0
    base_url: str = ""
    pssh: bytes = b""
    default_kid: str = ""
    representations: list = field(default_factory=list)
    source_url: str = ""


# ═══════════════════════════════════════════════════
# MPD Parser
# ═══════════════════════════════════════════════════

def resolve_template(template: str, rep: Representation, number: int, time_val: int) -> str:
    url = template
    url = url.replace("$RepresentationID$", rep.id)
    url = url.replace("$Bandwidth$", str(rep.bandwidth))
    url = re.sub(r'\$Number(%0?\d*d)?\$', lambda m: format(number, m.group(1)) if m.group(1) else str(number), url)
    url = re.sub(r'\$Time(%0?\d*d)?\$', lambda m: format(time_val, m.group(1)) if m.group(1) else str(time_val), url)
    return urljoin(rep.base_url, url)


class MPDParser:
    def __init__(self, mpd_url: str, headers: dict = None):
        self.url = mpd_url
        self.headers = headers or {}

    def fetch(self) -> bytes:
        r = requests.get(self.url, headers=self.headers, timeout=30)
        r.raise_for_status()
        return r.content

    def parse(self, xml_data: bytes) -> MPDData:
        root = etree.fromstring(xml_data)
        ns = {"mp": NS_MP, "cenc": NS_CENC}

        data = MPDData(
            type=root.get("type", "static"),
            base_url=self.url.rsplit("/", 1)[0] + "/",
            source_url=self.url,
        )

        if root.get("minimumUpdatePeriod"):
            data.minimum_update_period = self._parse_duration(root.get("minimumUpdatePeriod"))

        bu = root.find("mp:BaseURL", ns)
        if bu is not None and bu.text:
            data.base_url = urljoin(self.url, bu.text)

        period = root.find("mp:Period", ns)
        if period is None:
            raise ValueError("No Period in MPD")

        period_base = data.base_url
        pbu = period.find("mp:BaseURL", ns)
        if pbu is not None and pbu.text:
            period_base = urljoin(period_base, pbu.text)

        # Extract PSSH + KID
        for cp in root.iter("{%s}ContentProtection" % NS_MP):
            scheme = cp.get("schemeIdUri", "").lower()
            if WV_SYSTEM_ID in scheme:
                pe = cp.find("{%s}pssh" % NS_CENC)
                if pe is not None and pe.text:
                    data.pssh = base64.b64decode(pe.text.strip())
            kid = cp.get("{%s}default_KID" % NS_CENC)
            if kid and not data.default_kid:
                data.default_kid = kid.replace("-", "")

        for aset in period.findall("mp:AdaptationSet", ns):
            as_mime = aset.get("mimeType", "")
            as_ct = aset.get("contentType", "")
            as_lang = aset.get("lang", "")
            aset_base = period_base
            abu = aset.find("mp:BaseURL", ns)
            if abu is not None and abu.text:
                aset_base = urljoin(aset_base, abu.text)
            as_st = aset.find("mp:SegmentTemplate", ns)

            for rep_elem in aset.findall("mp:Representation", ns):
                rep = Representation(
                    id=rep_elem.get("id", ""),
                    bandwidth=int(rep_elem.get("bandwidth", "0")),
                    width=int(rep_elem.get("width", "0") or aset.get("width", "0") or 0),
                    height=int(rep_elem.get("height", "0") or aset.get("height", "0") or 0),
                    codecs=rep_elem.get("codecs", "") or aset.get("codecs", ""),
                    mime_type=rep_elem.get("mimeType", "") or as_mime,
                    content_type=rep_elem.get("contentType", "") or as_ct,
                    lang=rep_elem.get("lang", "") or as_lang,
                    base_url=aset_base,
                )

                st_elem = rep_elem.find("mp:SegmentTemplate", ns) or as_st
                if st_elem is not None:
                    rep.media_template = st_elem.get("media", "")
                    rep.init_url = st_elem.get("initialization", "")
                    rep.timescale = int(st_elem.get("timescale", "1"))
                    rep.start_number = int(st_elem.get("startNumber", "1"))
                    if st_elem.get("duration"):
                        rep.duration = int(st_elem.get("duration"))
                    tl = st_elem.find("mp:SegmentTimeline", ns)
                    if tl is not None:
                        rep.segments = self._parse_timeline(tl, rep)

                data.representations.append(rep)

        logger.info(f"MPD: type={data.type}, reps={len(data.representations)}, pssh={'yes' if data.pssh else 'no'}")
        return data

    def _parse_timeline(self, tl_elem, rep: Representation) -> list:
        ns = {"mp": NS_MP}
        segments = []
        t = 0
        num = rep.start_number
        for s in tl_elem.findall("mp:S", ns):
            ta = s.get("t")
            d = int(s.get("d", "0"))
            r = int(s.get("r", "0"))
            if ta is not None:
                t = int(ta)
            for _ in range(r + 1 if r >= 0 else 100000):
                segments.append(Segment(num, resolve_template(rep.media_template, rep, num, t), t, d))
                t += d
                num += 1
        return segments

    @staticmethod
    def _parse_duration(iso: str) -> float:
        m = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?', iso)
        return int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + float(m.group(3) or 0) if m else 0.0


# ═══════════════════════════════════════════════════
# Key Acquisition
# ═══════════════════════════════════════════════════

def acquire_clearkey_keys(kid: str, key: str) -> dict:
    return {kid.lower(): bytes.fromhex(key.lower())}


def acquire_widevine_keys(pssh_data: bytes, license_url: str, device_path: str, headers: dict = None) -> dict:
    """Widevine L3 key acquisition via pywidevine CDM."""
    if not HAS_WIDEVINE:
        logger.error("pywidevine not installed: pip install pywidevine")
        sys.exit(1)

    device = Device.load(device_path)
    cdm = Cdm.from_device(device)
    sid = cdm.open()

    pssh = PSSH(pssh_data)
    challenge, _ = cdm.get_license_challenge(sid, pssh)

    req_headers = {"Content-Type": "application/octet-stream"}
    if headers:
        req_headers.update(headers)

    resp = requests.post(license_url, data=challenge, headers=req_headers, timeout=30)
    resp.raise_for_status()

    cdm.parse_license(sid, resp.content)
    keys = {}
    for k in cdm.get_keys(sid):
        if k.type == "CONTENT":
            keys[k.kid.hex] = k.key.hex
            logger.info(f"  WV Key: {k.kid.hex}:{k.key.hex}")

    cdm.close(sid)

    # Return as {kid_hex: key_bytes}
    return {kid: bytes.fromhex(key) for kid, key in keys.items()}


# ═══════════════════════════════════════════════════
# Pipeline
# ═══════════════════════════════════════════════════

class PrimePipeline:
    """Premium pipeline: pure Python decrypt → FIFO → ffmpeg."""

    def __init__(self, mpd_data: MPDData, keys: dict, output: str,
                 headers: dict = None, video_rep: Representation = None,
                 audio_rep: Representation = None, supervise: bool = False):
        self.mpd = mpd_data
        self.keys = keys  # {kid_hex: key_bytes}
        self.output = output
        self.headers = headers or {}
        self.video_rep = video_rep
        self.audio_rep = audio_rep
        self.supervise = supervise
        self.running = False
        self.tempdir = tempfile.mkdtemp(prefix="widestring_")
        self.v_fifo = os.path.join(self.tempdir, "v")
        self.a_fifo = os.path.join(self.tempdir, "a")
        self.ffmpeg = None
        self.v_decryptor = None
        self.a_decryptor = None

    def _select_reps(self):
        if not self.video_rep or not self.audio_rep:
            vids = [r for r in self.mpd.representations if "video" in (r.content_type + r.mime_type).lower()]
            auds = [r for r in self.mpd.representations if "audio" in (r.content_type + r.mime_type).lower()]
            if not self.video_rep:
                self.video_rep = max(vids, key=lambda r: r.height) if vids else None
                if self.video_rep:
                    logger.info(f"Video: {self.video_rep.id} ({self.video_rep.height}p)")
            if not self.audio_rep and auds:
                self.audio_rep = max(auds, key=lambda r: r.bandwidth)
                logger.info(f"Audio: {self.audio_rep.id}")

    def _download(self, url: str, retries: int = 3) -> bytes:
        for attempt in range(retries):
            try:
                r = requests.get(url, headers=self.headers, timeout=30)
                r.raise_for_status()
                return r.content
            except requests.RequestException as e:
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)
                else:
                    raise

    def _setup_decryptor(self, init_data: bytes) -> tuple:
        """Parse init segment, create decryptor, return (cleaned_init, decryptor)."""
        si = get_scheme_info(init_data)
        scheme = si['scheme']
        tenc = si['tenc']

        # Match key
        kid = si['kid'] if si['kid'] else self.mpd.default_kid
        key_bytes = self.keys.get(kid.lower()) if kid else None

        if not key_bytes and self.keys:
            key_bytes = list(self.keys.values())[0]
            logger.warning(f"KID mismatch, using first available key")

        if not key_bytes:
            logger.error("No matching key found")
            return init_data, None

        decryptor = CENCDecryptor(
            key=key_bytes,
            scheme=scheme,
            cbcs_iv=tenc['constant_iv'] if tenc else None,
            crypt_block=tenc['crypt_block'] if tenc else 0,
            skip_block=tenc['skip_block'] if tenc else 0,
        )

        cleaned = clean_init_segment(init_data)
        logger.info(f"Init cleaned: scheme={scheme}, kid={kid}")
        return cleaned, decryptor

    def _start_ffmpeg(self):
        for f in (self.v_fifo, self.a_fifo):
            if os.path.exists(f):
                os.remove(f)
        os.mkfifo(self.v_fifo)
        has_audio = self.audio_rep is not None
        if has_audio:
            os.mkfifo(self.a_fifo)

        cmd = ["ffmpeg", "-loglevel", "warning", "-y", "-i", self.v_fifo]
        if has_audio:
            cmd += ["-i", self.a_fifo]
        cmd += ["-c", "copy"]
        if not has_audio:
            cmd += ["-an"]
        cmd += ["-f", "mpegts", "-mpegts_flags", "+resend_headers", self.output]

        logger.info(f"ffmpeg → {self.output}")
        self.ffmpeg = subprocess.Popen(cmd)

    def _write_init(self, v_fifo, a_fifo):
        if self.video_rep and self.video_rep.init_url:
            url = resolve_template(self.video_rep.init_url, self.video_rep, 0, 0)
            raw = self._download(url)
            cleaned, dec = self._setup_decryptor(raw)
            self.v_decryptor = dec
            v_fifo.write(cleaned)
            v_fifo.flush()

        if self.audio_rep and self.audio_rep.init_url:
            url = resolve_template(self.audio_rep.init_url, self.audio_rep, 0, 0)
            raw = self._download(url)
            cleaned, dec = self._setup_decryptor(raw)
            self.a_decryptor = dec
            a_fifo.write(cleaned)
            a_fifo.flush()

    def _process_live(self):
        self.running = True
        self._start_ffmpeg()
        v_fifo = open(self.v_fifo, "wb")
        a_fifo = open(self.a_fifo, "wb") if self.audio_rep else None

        last_refresh = time.time()
        v_idx = a_idx = 0
        seg_count = 0

        try:
            self._write_init(v_fifo, a_fifo)
            logger.info("Init written, entering live loop")

            while self.running:
                now = time.time()
                upd = self.mpd.minimum_update_period or 5

                if (now - last_refresh) > upd:
                    try:
                        parser = MPDParser(self.mpd.source_url, self.headers)
                        new_data = parser.parse(parser.fetch())
                        if self.video_rep:
                            for r in new_data.representations:
                                if r.id == self.video_rep.id and r.segments:
                                    existing = {s.number for s in self.video_rep.segments}
                                    self.video_rep.segments.extend(
                                        s for s in r.segments if s.number not in existing)
                        if self.audio_rep:
                            for r in new_data.representations:
                                if r.id == self.audio_rep.id and r.segments:
                                    existing = {s.number for s in self.audio_rep.segments}
                                    self.audio_rep.segments.extend(
                                        s for s in r.segments if s.number not in existing)
                    except Exception as e:
                        logger.error(f"MPD refresh: {e}")
                    last_refresh = now

                # Video segments
                if self.video_rep and v_idx < len(self.video_rep.segments):
                    seg = self.video_rep.segments[v_idx]
                    try:
                        data = self._download(seg.url)
                        if self.v_decryptor:
                            data = self.v_decryptor.decrypt_fragment(data)
                        v_fifo.write(data)
                        v_fifo.flush()
                        v_idx += 1
                        seg_count += 1
                    except requests.HTTPError as e:
                        if e.response.status_code == 404:
                            time.sleep(1)
                        else:
                            v_idx += 1
                    except Exception as e:
                        logger.error(f"V seg {seg.number}: {e}")
                        v_idx += 1

                # Audio segments
                if self.audio_rep and a_idx < len(self.audio_rep.segments):
                    seg = self.audio_rep.segments[a_idx]
                    try:
                        data = self._download(seg.url)
                        if self.a_decryptor:
                            data = self.a_decryptor.decrypt_fragment(data)
                        a_fifo.write(data)
                        a_fifo.flush()
                        a_idx += 1
                    except requests.HTTPError as e:
                        if e.response.status_code != 404:
                            a_idx += 1
                    except:
                        a_idx += 1

                # Live edge check
                v_edge = (not self.video_rep) or v_idx >= len(self.video_rep.segments)
                a_edge = (not self.audio_rep) or a_idx >= len(self.audio_rep.segments)
                if v_edge and a_edge:
                    time.sleep(min(upd, 3))
                    if seg_count > 0 and seg_count % 100 == 0:
                        logger.info(f"Live: {seg_count} segments, at edge")

                # ffmpeg health
                if self.ffmpeg.poll() is not None:
                    logger.warning("ffmpeg died, restarting...")
                    for f in (self.v_fifo, self.a_fifo):
                        if os.path.exists(f):
                            os.remove(f)
                    os.mkfifo(self.v_fifo)
                    if self.audio_rep:
                        os.mkfifo(self.a_fifo)
                    self._start_ffmpeg()
                    v_fifo = open(self.v_fifo, "wb")
                    if self.audio_rep:
                        a_fifo = open(self.a_fifo, "wb")
                    self._write_init(v_fifo, a_fifo)
                    logger.info("Pipeline restarted")

        finally:
            self.running = False
            try:
                if v_fifo: v_fifo.close()
                if a_fifo: a_fifo.close()
            except:
                pass
            if self.ffmpeg:
                try:
                    self.ffmpeg.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.ffmpeg.kill()

    def _process_vod(self):
        self._start_ffmpeg()
        v_fifo = open(self.v_fifo, "wb")
        a_fifo = open(self.a_fifo, "wb") if self.audio_rep else None

        try:
            self._write_init(v_fifo, a_fifo)
            v_segs = self.video_rep.segments if self.video_rep else []
            a_segs = self.audio_rep.segments if self.audio_rep else []
            total = max(len(v_segs), len(a_segs))

            for i in range(total):
                if self.video_rep and i < len(v_segs):
                    try:
                        data = self._download(v_segs[i].url)
                        if self.v_decryptor:
                            data = self.v_decryptor.decrypt_fragment(data)
                        v_fifo.write(data)
                        v_fifo.flush()
                    except Exception as e:
                        logger.error(f"V seg {v_segs[i].number}: {e}")
                if self.audio_rep and i < len(a_segs):
                    try:
                        data = self._download(a_segs[i].url)
                        if self.a_decryptor:
                            data = self.a_decryptor.decrypt_fragment(data)
                        a_fifo.write(data)
                        a_fifo.flush()
                    except Exception as e:
                        logger.error(f"A seg {a_segs[i].number}: {e}")
                if i % 50 == 0 and i > 0:
                    logger.info(f"Progress: {i}/{total}")

            logger.info(f"Done: {total} segments → {self.output}")
        finally:
            if v_fifo: v_fifo.close()
            if a_fifo: a_fifo.close()
            if self.ffmpeg:
                try:
                    self.ffmpeg.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    self.ffmpeg.kill()

    def run(self):
        self._select_reps()
        if self.mpd.type == "dynamic":
            logger.info("LIVE mode")
            self._process_live()
        else:
            logger.info("VOD mode")
            self._process_vod()

    def stop(self):
        self.running = False


# ═══════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════

def main():
    ap = argparse.ArgumentParser(
        description="Widestring Prime — Premium Pure Python CENC Decryptor",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--mpd", required=True, help="MPD manifest URL")
    ap.add_argument("--output", required=True, help="Output file or pipe")
    ap.add_argument("--headers", default=None, help="JSON HTTP headers")

    # ClearKey
    ap.add_argument("--kid", default=None, help="ClearKey KID (hex)")
    ap.add_argument("--key", default=None, help="ClearKey key (hex)")
    ap.add_argument("--clearkey", default=None, help="KID:KEY combined")

    # Widevine
    ap.add_argument("--drm", default="clearkey", choices=["clearkey", "widevine"])
    ap.add_argument("--license-url", default=None, help="Widevine license server URL")
    ap.add_argument("--device", default=None, help="Path to .wvd device file")
    ap.add_argument("--license-headers", default=None, help="JSON headers for license request")

    # Options
    ap.add_argument("--video-rep", default=None)
    ap.add_argument("--audio-rep", default=None)
    ap.add_argument("--supervise", action="store_true", help="24/7 auto-restart")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    if not HAS_CRYPTO:
        sys.stderr.write("Error: pip install cryptography\n")
        sys.exit(1)

    http_headers = json.loads(args.headers) if args.headers else {}
    lic_headers = json.loads(args.license_headers) if args.license_headers else {}

    # Acquire keys
    keys = {}
    if args.drm == "clearkey":
        if args.clearkey:
            parts = args.clearkey.split(":")
            kid, key_hex = parts[0].replace("-", "").lower(), parts[1].lower()
        elif args.kid and args.key:
            kid, key_hex = args.kid.replace("-", "").lower(), args.key.lower()
        else:
            sys.stderr.write("Provide --clearkey KID:KEY or --kid + --key\n")
            sys.exit(1)
        keys = acquire_clearkey_keys(kid, key_hex)
        logger.info(f"ClearKey: kid={kid}")
    elif args.drm == "widevine":
        if not args.license_url or not args.device:
            sys.stderr.write("Widevine needs --license-url and --device\n")
            sys.exit(1)
        # PSSH will be extracted from MPD/init segment during pipeline setup
        # For now, parse MPD to get PSSH
        parser = MPDParser(args.mpd, http_headers)
        mpd_data = parser.parse(parser.fetch())
        if not mpd_data.pssh:
            sys.stderr.write("No Widevine PSSH in MPD\n")
            sys.exit(1)
        keys = acquire_widevine_keys(mpd_data.pssh, args.license_url, args.device, lic_headers)
        if not keys:
            sys.stderr.write("No keys acquired\n")
            sys.exit(1)

    def run_once():
        parser = MPDParser(args.mpd, http_headers)
        mpd_data = parser.parse(parser.fetch())

        v_rep = next((r for r in mpd_data.representations if r.id == args.video_rep), None) if args.video_rep else None
        a_rep = next((r for r in mpd_data.representations if r.id == args.audio_rep), None) if args.audio_rep else None

        pipeline = PrimePipeline(
            mpd_data=mpd_data, keys=keys, output=args.output,
            headers=http_headers, video_rep=v_rep, audio_rep=a_rep,
            supervise=args.supervise,
        )

        def shutdown(sig, frame):
            pipeline.stop()
            sys.exit(0)

        signal.signal(signal.SIGINT, shutdown)
        signal.signal(signal.SIGTERM, shutdown)
        pipeline.run()

    if args.supervise:
        logger.info("Supervisor mode enabled")
        while True:
            try:
                run_once()
            except Exception as e:
                logger.error(f"Crashed: {e}")
            logger.info("Restarting in 5s...")
            time.sleep(5)
    else:
        run_once()


if __name__ == "__main__":
    main()
