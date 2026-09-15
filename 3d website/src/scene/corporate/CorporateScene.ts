import * as THREE from 'three';
import {
  EnvironmentId,
  IEnvironmentScene,
  IEnvironmentBounds,
  IMinimapRoom,
  ZoneBounds,
  ObstacleBox,
  TeleportBinding,
  IInteractable
} from '../../types';
import { Materials } from '../Materials';
import { OfficeFloorplan, OFFICE_ZONES } from '../OfficeFloorplan';
import { GlassBoard } from '../../hud/GlassBoard';
import { ZONE_METAS } from '../../hud/OperationsView';
import { disposeHierarchy } from '../common/DisposalUtils';

export class CorporateScene implements IEnvironmentScene {
  public readonly id: EnvironmentId = 'corporate';
  public readonly name: string = 'Corporate Office';
  public readonly defaultSpawnPosition: THREE.Vector3 = new THREE.Vector3(0.0, 1.6, 11.0);
  public readonly defaultSpawnYaw: number = 0.0;

  public readonly worldBounds: IEnvironmentBounds = {
    minX: -19.5,
    maxX: 19.5,
    minZ: -12.5,
    maxZ: 12.5,
    minY: 0.0,
    maxY: 4.0
  };

  public readonly group: THREE.Group = new THREE.Group();

  public readonly minimapRooms: IMinimapRoom[] = [
    { label: 'Lobby', bounds: [-20.0, 0.0, 20.0, 13.0] },
    { label: 'Open Office', bounds: [-20.0, -13.0, 5.0, 0.0] },
    { label: 'Conference', bounds: [5.0, -13.0, 20.0, 0.0] }
  ];

  public floorplan: OfficeFloorplan | null = null;
  public commandGlass?: GlassBoard;
  private materials: Materials;
  private interactables: IInteractable[] = [];

  constructor(materials?: Materials) {
    this.materials = materials || Materials.getInstance();
    this.group.name = 'CorporateSceneGroup';
  }

  public build(): void {
    if (this.floorplan && this.group.children.length > 0) {
      return;
    }

    this.floorplan = new OfficeFloorplan(this.materials);
    this.floorplan.build();
    this.group.add(this.floorplan.group);

    if (this.floorplan.commandGlass) {
      this.commandGlass = this.floorplan.commandGlass;
    }
  }

  public mount(parentScene: THREE.Scene): void {
    if (!this.floorplan || this.group.children.length === 0) {
      this.build();
    }
    parentScene.add(this.group);
  }

  public unmount(parentScene: THREE.Scene): void {
    parentScene.remove(this.group);
  }

  public dispose(): void {
    if (this.floorplan) {
      if (this.floorplan.glassBoards) {
        Object.values(this.floorplan.glassBoards).forEach(gb => gb.dispose?.());
      }
      if (this.floorplan.commandGlass) {
        this.floorplan.commandGlass.dispose?.();
      }
    }

    disposeHierarchy(this.group, { disposeSharedMaterials: false });
    this.floorplan = null;
    this.commandGlass = undefined;
    this.interactables = [];
  }

  public update(_delta: number, _time: number): void {
    // Per-frame updates for scene-specific nodes if any
  }

  public getObstacles(): ObstacleBox[] {
    return this.floorplan ? this.floorplan.getObstacles() : [];
  }

  public getInteractables(): IInteractable[] {
    return this.interactables;
  }

  public setInteractables(interactables: IInteractable[]): void {
    this.interactables = interactables;
  }

  public getZones(): Record<string, ZoneBounds> {
    return OFFICE_ZONES;
  }

  public getZoneMetas(): Record<string, any> {
    return ZONE_METAS;
  }

  public getGlassBoards(): Record<string, GlassBoard> {
    const result: Record<string, GlassBoard> = {};
    if (this.floorplan?.glassBoards) {
      Object.assign(result, this.floorplan.glassBoards);
    }
    if (this.commandGlass) {
      result.command = this.commandGlass;
    }
    return result;
  }

  public getMinimapRooms(): IMinimapRoom[] {
    return this.minimapRooms;
  }

  public getMascotPosition(): THREE.Vector3 {
    return new THREE.Vector3(0, 1.0, 7.5);
  }

  public getMascotSpawnPosition(): THREE.Vector3 {
    return new THREE.Vector3(0, 1.0, 7.5);
  }

  public getTeleportBindings(): TeleportBinding[] {
    return [
      { key: '1', zoneId: 'lobby', label: 'Lobby' },
      { key: '2', zoneId: 'open_office', label: 'Office' },
      { key: '3', zoneId: 'conference_room', label: 'Conf. Room' }
    ];
  }
}
