import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { OfficialLogo } from "./OfficialLogo";
import { C, shadow } from "../theme";

export function Brand({ width = 196 }: { width?: number }) {
  return <OfficialLogo width={width} />;
}

export function Card({children,style}:{children:React.ReactNode;style?:any}) {
  return <View style={[s.card,style]}>{children}</View>;
}

export function PrimaryButton({title,onPress,disabled}:{title:string;onPress?:()=>void;disabled?:boolean}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[s.primary,disabled&&{opacity:.45}]}>
      <Text style={s.primaryText}>{title}</Text>
      <Ionicons name="chevron-forward" size={20} color="#fff" />
    </Pressable>
  );
}

export function FieldRow({icon,title,value,onPress}:{icon:any;title:string;value?:string;onPress?:()=>void}) {
  return (
    <Pressable onPress={onPress} style={s.field}>
      <View style={s.fieldIcon}><Ionicons name={icon} size={20} color={C.blue}/></View>
      <Text style={s.fieldTitle}>{title}</Text>
      {value ? <Text style={s.fieldValue} numberOfLines={1}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={18} color={C.text}/>
    </Pressable>
  );
}

export function BottomNav({active,onChange}:{active:string;onChange:(v:string)=>void}) {
  const items=[
    ["home","Inicio","home-outline"],
    ["trips","Viajes","search-outline"],
    ["publish","Publicar","add-circle-outline"],
    ["messages","Mensajes","chatbox-ellipses-outline"],
    ["profile","Perfil","person-outline"],
  ] as const;
  return (
    <View style={s.nav}>
      {items.map(([key,label,icon])=>(
        <Pressable key={key} style={s.navItem} onPress={()=>onChange(key)}>
          <Ionicons name={icon} size={23} color={active===key?C.blue:"#60739B"}/>
          <Text style={[s.navText,active===key&&{color:C.blue,fontWeight:"800"}]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s=StyleSheet.create({
  card:{backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:18,padding:14,...shadow},
  primary:{minHeight:56,borderRadius:16,backgroundColor:C.blue,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8,marginTop:12,paddingHorizontal:18},
  primaryText:{color:"#fff",fontSize:17,fontWeight:"800",textAlign:"center"},
  field:{minHeight:58,borderBottomWidth:1,borderBottomColor:C.border,flexDirection:"row",alignItems:"center",gap:10,paddingHorizontal:4},
  fieldIcon:{width:28,alignItems:"center"},
  fieldTitle:{fontSize:14,fontWeight:"800",color:C.text,flexShrink:0},
  fieldValue:{fontSize:13,color:C.muted,flex:1,textAlign:"right"},
  nav:{height:74,backgroundColor:"#fff",borderTopWidth:1,borderTopColor:C.border,flexDirection:"row",alignItems:"center",justifyContent:"space-around",paddingBottom:8,paddingTop:6},
  navItem:{alignItems:"center",justifyContent:"center",minWidth:55},
  navText:{fontSize:10,color:"#60739B",marginTop:2},
});
