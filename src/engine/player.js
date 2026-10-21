import * as THREE from 'three';
import { leftFootPhase } from './character.js';

const GRAVITY = 9.81;
const JUMP_SPEED = 3.0;      // ~0.45 m, a typical standing jump
const ANTICIPATION = 0.16;   // seconds of crouch before take-off
const STEP = 0.35;           // highest step walked up or down without jumping or falling

const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _axis = new THREE.Vector3();

export class Player {
  constructor(avatar, anim, input) {
    this.input = input;
    this.model = avatar.root;
    this.gait = anim.gait;
    this.height = avatar.height;
    this.hairCenter = avatar.hairCenter;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    // optional hooks for worlds with floors and walls: the floor height under (x, z) for a
    // body standing at y, and collide(position, velocity) to push the body out of obstacles
    this.groundAt = () => 0;
    this.collide = null;
    this.yaw = 0;
    this.yawRate = 0;
    this.grounded = true;
    this.jumpTimer = -1;
    this.crouch = 0;          // 0..1 knee bend from anticipation / landing
    this.landImpulse = 0;
    this.air = 0;             // 0..1 airborne tuck
    this.phase = 0;           // normalised locomotion phase shared by walk + run
    this.lookYaw = 0;

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const name of ['idle', 'walk', 'run']) {
      const a = this.mixer.clipAction(anim.clips[name]);
      a.play();
      a.setEffectiveWeight(name === 'idle' ? 1 : 0);
      if (name !== 'idle') a.timeScale = 0; // driven manually through this.phase
      this.actions[name] = a;
    }
    this.runPhaseOffset = leftFootPhase(avatar, anim.clips.run) - leftFootPhase(avatar, anim.clips.walk);

    const b = (s) => this.model.getObjectByName('Bip01_' + s);
    this.bones = {
      hips: this.model.getObjectByName('Bip01'), spine: b('Spine'), spine1: b('Spine1'), spine2: b('Spine2'), neck: b('Neck'), head: b('Head'),
      lUpLeg: b('L_Thigh'), lLeg: b('L_Calf'), lFoot: b('L_Foot'),
      rUpLeg: b('R_Thigh'), rLeg: b('R_Calf'), rFoot: b('R_Foot'),
      lArm: b('L_UpperArm'), rArm: b('R_UpperArm'), lForeArm: b('L_Forearm'), rForeArm: b('R_Forearm'),
    };
  }

  update(dt, cameraYaw) {
    const inp = this.input;
    const { walk, run } = this.gait;

    // --- intent: camera-relative direction, walk or run speed
    let ix = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let iz = (inp.forward ? 1 : 0) - (inp.back ? 1 : 0);
    // an on-screen joystick (touch): its direction, x to the right and y forward
    if (!ix && !iz && inp.stick && (inp.stick.x || inp.stick.y)) { ix = inp.stick.x; iz = inp.stick.y; }
    const len = Math.hypot(ix, iz);
    const targetSpeed = len > 0 ? (inp.run ? run.speed : walk.speed) : 0;
    const target = new THREE.Vector3();
    if (len > 0) {
      ix /= len; iz /= len;
      const s = Math.sin(cameraYaw), c = Math.cos(cameraYaw);
      // camera looks along -Z rotated by yaw
      target.set(-s * iz + c * ix, 0, -c * iz - s * ix).multiplyScalar(targetSpeed);
    }

    // --- horizontal motion: humans accelerate quickly but not instantly; less control in the air
    const accel = this.grounded ? (targetSpeed > this.horizontalSpeed() ? 7 : 10) : 1.5;
    _v.set(target.x - this.velocity.x, 0, target.z - this.velocity.z);
    const maxDv = accel * dt;
    if (_v.length() > maxDv) _v.setLength(maxDv);
    if (this.jumpTimer >= 0) _v.multiplyScalar(0.3);
    this.velocity.x += _v.x; this.velocity.z += _v.z;

    // --- jump: crouch first, then leave the ground
    if (inp.consumeJump() && this.grounded && this.jumpTimer < 0) this.jumpTimer = 0;
    if (this.jumpTimer >= 0) {
      this.jumpTimer += dt;
      if (this.jumpTimer >= ANTICIPATION) {
        this.velocity.y = JUMP_SPEED + this.horizontalSpeed() * 0.08;
        this.grounded = false;
        this.jumpTimer = -1;
      }
    }
    if (!this.grounded) {
      this.velocity.y -= GRAVITY * dt;
      this.position.y += this.velocity.y * dt;
      const floor = this.groundAt(this.position.x, this.position.z, this.position.y);
      if (this.position.y <= floor) {
        this.landImpulse = THREE.MathUtils.clamp(-this.velocity.y / 4.5, 0.25, 1);
        this.position.y = floor; this.velocity.y = 0; this.grounded = true;
      }
    }
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    // walls and furniture push the body back; then follow the floor up a step or down a
    // small drop, and fall from anything higher
    this.collide?.(this.position, this.velocity);
    if (this.grounded) {
      const floor = this.groundAt(this.position.x, this.position.z, this.position.y);
      if (floor < this.position.y - STEP) this.grounded = false;
      else this.position.y = floor;
    }

    // --- facing: turn toward travel direction with a rate limit, remember the turn rate for leaning
    const hs = this.horizontalSpeed();
    if (hs > 0.15 && this.grounded) {
      const want = Math.atan2(this.velocity.x, this.velocity.z);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const step = THREE.MathUtils.clamp(d, -9 * dt, 9 * dt) * Math.min(1, 12 * dt * 2);
      this.yaw += step;
      this.yawRate = THREE.MathUtils.lerp(this.yawRate, step / Math.max(dt, 1e-4), 1 - Math.exp(-8 * dt));
    } else {
      this.yawRate = THREE.MathUtils.lerp(this.yawRate, 0, 1 - Math.exp(-8 * dt));
    }

    this.model.position.copy(this.position);
    this.model.rotation.y = this.yaw;

    // --- locomotion blend weights and a shared phase so walk and run stay foot-synchronised
    const t = THREE.MathUtils.clamp((hs - walk.speed) / (run.speed - walk.speed), 0, 1);
    const wMove = THREE.MathUtils.clamp(hs / (walk.speed * 0.7), 0, 1);
    const groundW = this.grounded ? 1 : 0.35;
    const strideSpeed = THREE.MathUtils.lerp(walk.speed, run.speed, t);
    const cycle = THREE.MathUtils.lerp(walk.duration, run.duration, t);
    const rate = Math.max(hs / strideSpeed, wMove > 0.01 ? 0.55 : 0);
    if (this.grounded) this.phase = (this.phase + (dt / cycle) * rate) % 1;

    this.actions.idle.setEffectiveWeight(1 - wMove * groundW);
    this.actions.walk.setEffectiveWeight(wMove * (1 - t) * groundW);
    this.actions.run.setEffectiveWeight(wMove * t * groundW);
    this.actions.walk.time = this.phase * walk.duration;
    this.actions.run.time = (((this.phase + this.runPhaseOffset) % 1) + 1) % 1 * run.duration;

    this.mixer.update(dt);

    // --- procedural layers on top of the clips
    const anticip = this.jumpTimer >= 0 ? this.jumpTimer / ANTICIPATION : 0;
    this.landImpulse = Math.max(0, this.landImpulse - dt * 3.2);
    const crouchTarget = Math.max(anticip * 0.9, Math.sin(Math.min(1, this.landImpulse) * Math.PI * 0.5) * this.landImpulse);
    this.crouch = THREE.MathUtils.lerp(this.crouch, crouchTarget, 1 - Math.exp(-30 * dt));
    // tuck peaks around the apex and opens up again (legs reach for the ground) on the way down
    const airTarget = this.grounded ? 0 : THREE.MathUtils.clamp(1 - Math.abs(this.velocity.y) / JUMP_SPEED * 0.7, 0.3, 1);
    this.air = THREE.MathUtils.lerp(this.air, airTarget, 1 - Math.exp(-(this.grounded ? 25 : 10) * dt));

    this.lookYaw = THREE.MathUtils.lerp(this.lookYaw, wrap(cameraYaw + Math.PI - this.yaw), 1 - Math.exp(-4 * dt));
    this.applyProcedural(hs, t);
    // centre of the head for the hair's volume shading (a little above the head joint)
    if (this.hairCenter) { this.bones.head.getWorldPosition(this.hairCenter.value); this.hairCenter.value.y += 0.07; }
  }

  horizontalSpeed() { return Math.hypot(this.velocity.x, this.velocity.z); }

  applyProcedural(hs, runT) {
    const m = this.model;
    m.updateMatrixWorld(true);
    const right = _axis.set(-1, 0, 0).applyQuaternion(m.quaternion).clone();
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion);
    const up = new THREE.Vector3(0, 1, 0);
    const B = this.bones;

    // crouch (anticipation + landing): bend hips/knees/ankles symmetrically and drop the pelvis
    const c = this.crouch;
    const a = c * 0.75;          // thigh angle
    const air = this.air;
    const tuckHip = air * 0.75, tuckKnee = air * 1.35;
    for (const [up_, lo, ft, side] of [[B.lUpLeg, B.lLeg, B.lFoot, 1], [B.rUpLeg, B.rLeg, B.rFoot, -1]]) {
      const hip = a + tuckHip * (side > 0 ? 1 : 0.7);
      const knee = 2 * a + tuckKnee * (side > 0 ? 1 : 0.8);
      rotateWorld(up_, right, hip);
      rotateWorld(lo, right, -knee);
      rotateWorld(ft, right, knee - hip - air * 0.25);
    }
    rotateWorld(B.spine, right, -c * 0.35 - air * 0.12);
    if (c > 0.001) {
      const thigh = 0.245 * this.height;
      const drop = 2 * thigh * (1 - Math.cos(a));
      const hp = B.hips.getWorldPosition(new THREE.Vector3());
      hp.y -= drop;
      hp.addScaledVector(fwd, -drop * 0.25);
      B.hips.parent.worldToLocal(hp);
      B.hips.position.copy(hp);
      B.hips.updateMatrixWorld(true);
    }
    // arms swing back while crouching, then drive forward and up through take-off and flight
    const anticipArms = this.jumpTimer >= 0 ? -0.7 * c : 0.35 * c;
    rotateWorld(B.lArm, right, anticipArms + air * 0.55);
    rotateWorld(B.rArm, right, anticipArms + air * 0.55);
    rotateWorld(B.lForeArm, right, air * 0.6);
    rotateWorld(B.rForeArm, right, air * 0.6);

    // lean into turns and slightly forward when running
    const lean = THREE.MathUtils.clamp(-this.yawRate * hs * 0.035, -0.22, 0.22);
    rotateWorld(B.hips, fwd, lean);
    rotateWorld(B.spine1, right, -runT * Math.min(hs, 5) * 0.025);

    // head and upper spine follow where the camera looks (limited, like a real neck)
    const look = THREE.MathUtils.clamp(this.lookYaw, -1.0, 1.0) * (1 - Math.min(1, hs / 3) * 0.6);
    rotateWorld(B.spine2, up, look * 0.2);
    rotateWorld(B.neck, up, look * 0.35);
    rotateWorld(B.head, up, look * 0.35);
  }
}

// rotate a bone by `angle` around an axis given in world space
function rotateWorld(bone, axisWorld, angle) {
  if (Math.abs(angle) < 1e-5) return;
  bone.parent.getWorldQuaternion(_qp);
  _q.setFromAxisAngle(axisWorld, angle);
  // parent^-1 * q * parent
  const local = _qp.clone().invert().multiply(_q).multiply(_qp);
  bone.quaternion.premultiply(local);
  bone.updateMatrixWorld(true);
}

function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
