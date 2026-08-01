export class Vector2D {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    add(v) {
        return new Vector2D(this.x + v.x, this.y + v.y);
    }

    sub(v) {
        return new Vector2D(this.x - v.x, this.y - v.y);
    }

    mul(scalar) {
        return new Vector2D(this.x * scalar, this.y * scalar);
    }

    div(scalar) {
        return new Vector2D(this.x / scalar, this.y / scalar);
    }

    length() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    lengthSq() {
        return this.x * this.x + this.y * this.y;
    }

    normalize() {
        const len = this.length();
        if (len > 0) {
            return this.div(len);
        }
        return new Vector2D(0, 0);
    }

    dot(v) {
        return this.x * v.x + this.y * v.y;
    }

    distance(v) {
        return this.sub(v).length();
    }

    distanceSq(v) {
        return this.sub(v).lengthSq();
    }

    clone() {
        return new Vector2D(this.x, this.y);
    }

    set(x, y) {
        this.x = x;
        this.y = y;
        return this;
    }
}
