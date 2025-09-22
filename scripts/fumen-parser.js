/**
 * Tetfu (テト譜) のエンコードとデコードを行うライブラリ
 */
const Tetfu = {};

(function(exports) {
	'use strict';

	// 定数定義
	const FIELD_WIDTH = 10;
	const FIELD_HEIGHT = 24;
	const FIELD_NUM_CELLS = FIELD_WIDTH * FIELD_HEIGHT;
	const FUMEN_VERSION = "v115@";

	// 型安全なenumの代替
	const MinoType = Object.freeze({
		N_BLOCK: 0,
		I_BLOCK: 1,
		L_BLOCK: 2,
		O_BLOCK: 3,
		Z_BLOCK: 4,
		T_BLOCK: 5,
		J_BLOCK: 6,
		S_BLOCK: 7,
		G_BLOCK: 8,
	});

	const Rotation = Object.freeze({
		South: 0,
		East: 1,
		North: 2,
		West: 3
	});

	// 構造体の代替となるクラス
	class Piece {
		constructor() {
			this.type = MinoType.N_BLOCK;
			this.rotation = Rotation.North;
			this.location = 0;
		}
	}

	class Flags {
		constructor() {
			this.raise = false;
			this.mirror = false;
			this.color = true;
			this.lock = true;
			this.comment = "";
		}
	}

	// 1ページ分の譜面データ
	class FumenPage {
		constructor() {
			this.field = new Array(FIELD_NUM_CELLS).fill(0);
			this.piece = new Piece();
			this.flags = new Flags();
		}
	}

	// エンコード・デコード用の内部ヘルパー関数群
	const details = {
		ENCODE_TABLE: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
		DECODE_TABLE: new Map(),

		init() {
			for(let i = 0; i < 64; ++i) {
				this.DECODE_TABLE.set(this.ENCODE_TABLE[i], i);
			}
		},

		unpoll(value, numChars) {
			let result = '';
			for(let i = 0; i < numChars; ++i) {
				result += this.ENCODE_TABLE[value % 64];
				value = Math.floor(value / 64);
			}
			return result;
		},

		poll(data, pos, count) {
			let value = 0;
			let multiplier = 1;
			if(pos.value + count > data.length) {
				throw new Error("Data stream ended unexpectedly during poll.");
			}
			for(let i = 0; i < count; ++i) {
				value += data[pos.value + i] * multiplier;
				multiplier *= 64;
			}
			pos.value += count;
			return value;
		},

		percentEncode(str) {
			let result = '';
			for(const char of str) {
				const code = char.charCodeAt(0);
				if(
					(code >= 48 && code <= 57) || // 0-9
					(code >= 65 && code <= 90) || // A-Z
					(code >= 97 && code <= 122) || // a-z
					char === '-' || char === '_' || char === '.' || char === '~'
				) {
					result += char;
				} else {
					const hex = code.toString(16).toUpperCase();
					result += '%' + (hex.length < 2 ? '0' : '') + hex;
				}
			}
			return result;
		},

		percentDecode(str) {
			let result = '';
			for(let i = 0; i < str.length; ++i) {
				if(str[i] === '%' && i + 2 < str.length) {
					const hex = str.substring(i + 1, i + 3);
					if(/^[0-9A-Fa-f]{2}$/.test(hex)) {
						result += String.fromCharCode(parseInt(hex, 16));
						i += 2;
					} else {
						result += str[i];
					}
				} else {
					result += str[i];
				}
			}
			return result;
		}
	};
	details.init();


	// テト譜全体を管理するクラス
	class Fumen {
		constructor() {
			this.pages = [];
		}

		addPage(newPage) {
			this.pages.push(newPage);
		}

		getPages() {
			return this.pages;
		}

		/**
		 * テト譜文字列をデコードしてFumenオブジェクトを生成する
		 * @param {string} data - v115@... から始まるテト譜文字列
		 * @returns {Fumen|null} デコードに成功した場合はFumenオブジェクト、失敗した場合はnull
		 */
		static decode(data) {
			if(!data.startsWith(FUMEN_VERSION)) {
				return null;
			}
			data = data.substring(FUMEN_VERSION.length);

			const numData = [];
			for(const char of data) {
				if(char !== '?') {
					numData.push(details.DECODE_TABLE.get(char) || 0);
				}
			}

			const fumen = new Fumen();
			let prevPage = new FumenPage();
			let pos = { value: 0 }; // ポインタの代替としてオブジェクトで参照渡し

			try {
				while(pos.value < numData.length) {
					const currentPage = new FumenPage();
					let cellCount = 0;
					while(cellCount < FIELD_NUM_CELLS) {
						const value = details.poll(numData, pos, 2);
						const diff = Math.floor(value / FIELD_NUM_CELLS);
						const repeat = value % FIELD_NUM_CELLS + 1;
						for(let i = 0; i < repeat && cellCount < FIELD_NUM_CELLS; ++i) {
							currentPage.field[cellCount] = prevPage.field[cellCount] + diff - 8;
							cellCount++;
						}
					}

					let value = details.poll(numData, pos, 3);
					currentPage.piece.type = value % 8;
					value = Math.floor(value / 8);
					currentPage.piece.rotation = value % 4;
					value = Math.floor(value / 4);
					currentPage.piece.location = value % FIELD_NUM_CELLS;
					value = Math.floor(value / FIELD_NUM_CELLS);
					currentPage.flags.raise = (value % 2 !== 0);
					value = Math.floor(value / 2);
					currentPage.flags.mirror = (value % 2 !== 0);
					value = Math.floor(value / 2);
					currentPage.flags.color = (value % 2 !== 0);
					value = Math.floor(value / 2);
					const hasComment = (value % 2 !== 0);
					value = Math.floor(value / 2);
					currentPage.flags.lock = (value % 2 === 0);

					if(hasComment) {
						const len = details.poll(numData, pos, 2);
						const numChunks = Math.ceil(len / 4);
						let escapedComment = '';
						for(let i = 0; i < numChunks; ++i) {
							let chunkValue = details.poll(numData, pos, 5);
							for(let j = 0; j < 4; ++j) {
								escapedComment += String.fromCharCode(chunkValue % 96 + 32); // ' ' is 32
								chunkValue = Math.floor(chunkValue / 96);
							}
						}
						currentPage.flags.comment = details.percentDecode(escapedComment.substring(0, len));
					}
					fumen.addPage(currentPage);
					prevPage = currentPage;
				}
			} catch(e) {
				console.error("Decoding error:", e.message);
				return null;
			}
			return fumen;
		}

		/**
		 * Fumenオブジェクトをテト譜文字列にエンコードする
		 * @returns {string} テト譜文字列
		 */
		encode() {
			let result = FUMEN_VERSION;
			let prevPage = new FumenPage();

			for(const currentPage of this.pages) {
				let diffCount = 0;
				let lastDiff = 0;
				for(let i = 0; i < FIELD_NUM_CELLS; ++i) {
					const diff = currentPage.field[i] - prevPage.field[i] + 8;
					if(i > 0 && diff !== lastDiff) {
						result += details.unpoll(lastDiff * FIELD_NUM_CELLS + diffCount - 1, 2);
						diffCount = 0;
					}
					lastDiff = diff;
					diffCount++;
				}
				result += details.unpoll(lastDiff * FIELD_NUM_CELLS + diffCount - 1, 2);

				let value = 0;
				const hasComment = currentPage.flags.comment.length > 0;

				value = (currentPage.flags.lock ? 0 : 1) + value * 2;
				value = (hasComment ? 1 : 0) + value * 2;
				value = (currentPage.flags.color ? 1 : 0) + value * 2;
				value = (currentPage.flags.mirror ? 1 : 0) + value * 2;
				value = (currentPage.flags.raise ? 1 : 0) + value * 2;
				value = currentPage.piece.location + value * FIELD_NUM_CELLS;
				value = currentPage.piece.rotation + value * 4;
				value = currentPage.piece.type + value * 8;
				result += details.unpoll(value, 3);

				if(hasComment) {
					const escapedComment = details.percentEncode(currentPage.flags.comment);
					result += details.unpoll(escapedComment.length, 2);
					for(let i = 0; i < escapedComment.length; i += 4) {
						let chunkValue = 0;
						let multiplier = 1;
						for(let j = 0; j < 4; ++j) {
							const char = (i + j < escapedComment.length) ? escapedComment[i + j] : ' ';
							chunkValue += (char.charCodeAt(0) - 32) * multiplier;
							multiplier *= 96;
						}
						result += details.unpoll(chunkValue, 5);
					}
				}
				prevPage = currentPage;
			}
			return result;
		}
	}

	// 公開するAPI
	exports.Fumen = Fumen;
	exports.MinoType = MinoType;
	exports.Rotation = Rotation;
	exports.FumenPage = FumenPage;
	exports.FIELD_WIDTH = FIELD_WIDTH;
	exports.FIELD_HEIGHT = FIELD_HEIGHT;

})(Tetfu);
