# Third-Party Notices

This document records the notice for the color profile distributed with the PDF/X-4 export path. Product and standard names identify compatibility or an intended printing condition; they do not imply endorsement by their owners.

## FOGRA39L Coated ICC color profile

- Distributed file: `src-tauri/resources/color/FOGRA39L_coated.icc`
- Installed resource: `color/FOGRA39L_coated.icc`
- Profile description: `FOGRA39L Coated`
- Profile device class: printer output (`prtr`)
- Profile color space: CMYK
- SHA-256: `b35713ef7eff09349d4c3249e5f377736d06d8a2671c54712971a3546bf17c57`

### Provenance and rights information

The distributed bytes are identical to `FOGRA39L_coated.icc` from TeX Live's
`colorprofiles` package, version `20181105` (CTAN package
[`/support/colorprofiles`](https://ctan.org/pkg/colorprofiles)). TeX Live records
the package as a collection of free ICC profiles. Its source profile and the
file in this application have the same SHA-256 shown above.

The TeX Live package states that Peter Selinger generated the ICC file from
`FOGRA39L_coated.iccprofile.xml` with `cd-create-profile` from Debian
`colord` 1.4.3. His clarification is archived in the
[TeX Live mailing list](https://tug.org/pipermail/tex-live/2018-September/042340.html).
The relevant rights waiver is reproduced verbatim:

> Since the ICC files just contain the information from the XML files in a
> different data format, the ICC files are not in themselves original works
> and therefore not copyrightable in their own right. However, for greater
> clarity, to the extent that I have any rights to these files as their
> creator, I hereby waive all of my rights to the work worldwide under
> copyright law, including all related and neighboring rights, to the extent
> allowed by law.

The source XML declares `<license>CC0</license>`,
`<data_source>standard</data_source>`, and
`<standard_space>fogra39l</standard_space>`. It identifies the characterization
data originator as `Fogra, www.fogra.org`. The profile itself embeds this
statement:

> This profile is free of known copyright restrictions

The upstream TeX Live notice attributes the FOGRA39L data to:

- Kai-Uwe Behrmann, <https://www.behrmann.name>
- Marti Maria, <https://www.littlecms.com>
- Photogamut, <https://www.photogamut.org>
- Graeme Gill, <https://www.argyllcms.com>
- ColorSolutions, <https://www.basICColor.com>

The profile header identifies LittleCMS (`lcms`) as its creator. The ICC file,
its characterization data, and the notices in this section are third-party
material; they are **not** licensed under the Wanxiang Deck
GPL-3.0-or-later license.
Wanxiang Deck redistributes the unchanged upstream bytes and preserves the
following upstream terms.

### Upstream zlib/libpng terms for the FOGRA39L data

> This software is provided 'as-is', without any express or implied warranty.
> In no event will the authors be held liable for any damages arising from the
> use of this software.
>
> Permission is granted to anyone to use this software for any purpose,
> including commercial applications, and to alter it and redistribute it
> freely, subject to the following restrictions:
>
> 1. The origin of this software must not be misrepresented; you must not claim
>    that you wrote the original software. If you use this software in a
>    product, an acknowledgment in the product documentation would be
>    appreciated but is not required.
>
> 2. Altered source versions must be plainly marked as such, and must not be
>    misrepresented as being the original software.
>
> 3. This notice may not be removed or altered from any source distribution.

### Upstream data disclaimer

> BECAUSE THE DATA IS LICENSED FREE OF CHARGE, THERE IS NO WARRANTY FOR THE
> DATA, TO THE EXTENT PERMITTED BY APPLICABLE LAW. EXCEPT WHEN OTHERWISE STATED
> IN WRITING THE COPYRIGHT HOLDERS AND/OR OTHER PARTIES PROVIDE THE DATA "AS
> IS" WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING, BUT
> NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
> PARTICULAR PURPOSE. THE ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE OF THE
> DATA IS WITH YOU. SHOULD THE DATA PROVE DEFECTIVE, YOU ASSUME THE COST OF ALL
> NECESSARY SERVICING, REPAIR OR CORRECTION.
>
> IN NO EVENT UNLESS REQUIRED BY APPLICABLE LAW OR AGREED TO IN WRITING WILL ANY
> COPYRIGHT HOLDER, OR ANY OTHER PARTY WHO MAY MODIFY AND/OR REDISTRIBUTE THE
> DATA AS PERMITTED ABOVE, BE LIABLE TO YOU FOR DAMAGES, INCLUDING ANY GENERAL,
> SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF THE USE OR
> INABILITY TO USE THE DATA (INCLUDING BUT NOT LIMITED TO LOSS OF DATA OR DATA
> BEING RENDERED INACCURATE OR LOSSES SUSTAINED BY YOU OR THIRD PARTIES OR A
> FAILURE OF THE DATA TO OPERATE WITH ANY OTHER PROGRAMS), EVEN IF SUCH HOLDER
> OR OTHER PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

No additional copyright, patent, trademark, fitness-for-purpose, or
printing-result warranty is granted by Wanxiang Deck.

FOGRA39L identifies a coated-paper characterization condition. This bundled profile is not proof that a particular printer, paper, ink, coating, laminate, spot color, or production run conforms to that condition. Users and print providers remain responsible for selecting the actual output condition, running professional preflight, producing a contract or soft proof where appropriate, and approving a physical proof before volume production.

The project verifier pins the exact bytes above so that a changed or substituted profile cannot silently pass release checks. Its automated PDF/X-4 checks do not replace Adobe Acrobat Preflight, callas pdfToolbox, a print provider's preflight, or physical proofing.

## PDF/X-4 Rust libraries

The desktop PDF/X-4 implementation includes the following libraries:

- `lcms2` 6.1.1, copyright Kornel Lesiński, MIT License, <https://github.com/kornelski/rust-lcms2>
- `lcms2-sys` 4.0.7 and its statically linked Little CMS 2.19 source, copyright Marti Maria Saguer and contributors, MIT License, <https://github.com/kornelski/rust-lcms2-sys>
- `jpeg-encoder` 0.7.1, copyright Volker Ströbel and contributors, `(MIT OR Apache-2.0) AND IJG`, <https://github.com/vstroebel/jpeg-encoder>
- `png` 0.18.1, copyright nwin and contributors, `MIT OR Apache-2.0`, <https://github.com/image-rs/image-png>

For the dual-licensed portions of `jpeg-encoder` and `png`, this distribution uses the MIT option. The common MIT terms are reproduced below; all listed copyright notices remain with their respective works.

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

### Independent JPEG Group notice

This software is based in part on the work of the Independent JPEG Group.

The IJG-derived portions used by `jpeg-encoder` include its forward discrete cosine transform implementations. Their accompanying terms state:

> The authors make NO WARRANTY or representation, either express or implied,
> with respect to this software, its quality, accuracy, merchantability, or
> fitness for a particular purpose. This software is provided "AS IS", and you,
> its user, assume the entire risk as to its quality and accuracy.
>
> This software is copyright (C) 1991-2020, Thomas G. Lane, Guido Vollbeding.
> All Rights Reserved except as specified below.
>
> Permission is hereby granted to use, copy, modify, and distribute this
> software (or portions thereof) for any purpose, without fee, subject to these
> conditions:
>
> (1) If any part of the source code for this software is distributed, then the
> IJG README file must be included, with its copyright and no-warranty notice
> unaltered; and any additions, deletions, or changes to the original files must
> be clearly indicated in accompanying documentation.
>
> (2) If only executable code is distributed, then the accompanying
> documentation must state that "this software is based in part on the work of
> the Independent JPEG Group".
>
> (3) Permission for use of this software is granted only if the user accepts
> full responsibility for any undesirable consequences; the authors accept NO
> LIABILITY for damages of any kind.
>
> Permission is NOT granted for the use of any IJG author's name or company name
> in advertising or publicity relating to this software or products derived
> from it. This software may be referred to only as "the Independent JPEG
> Group's software".
